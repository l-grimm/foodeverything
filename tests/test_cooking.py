"""No live OpenAI or Supabase calls: all provider boundaries are mocked."""

from __future__ import annotations

import copy
import os
import time
import unittest
from unittest.mock import MagicMock, patch

from food_everything.cooking_policy import (
    advance,
    approve,
    conflicts,
    fingerprint,
    sign,
    unresolved,
    validate_change,
    verify,
)

RECIPE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
RECIPE = {"id": RECIPE_ID, "title": "Fruit crumble", "instructions": ["Prepare fruit.", "Bake."]}
INGREDIENTS = [
    {
        "id": "fruit",
        "name": "apples",
        "name_raw": "2 apples",
        "amount": "2",
        "unit": None,
        "prep_note": None,
    }
]
SECRET = "test-only-secret"


def initial():
    return {
        "recipe": copy.deepcopy(RECIPE),
        "ingredients": copy.deepcopy(INGREDIENTS),
        "version": fingerprint(RECIPE, INGREDIENTS),
        "expires": time.time() + 1000,
        "phase": "cooking",
        "step": -1,
        "guests": "none",
        "equipment": "oven",
        "pending": None,
        "approved": [],
        "saved": [],
        "history": [],
    }


class PolicyTests(unittest.TestCase):
    def test_exact_allergies_and_derivatives(self):
        for name in [
            "apples",
            "pear juice",
            "peach",
            "peaches",
            "plums",
            "nectarines",
            "apricots",
            "cherries",
            "almond flour",
            "mussels",
            "marzipan",
            "apple cider vinegar",
            "prunes",
            "pluots",
            "greengage",
            "amaretto",
            "mango",
            "mangoes",
            "dates",
            "lychee",
            "umeboshi",
            "kirsch",
        ]:
            with self.subTest(name=name):
                self.assertTrue(conflicts(name))

    def test_no_unrelated_nut_shellfish_or_substring_restrictions(self):
        for name in [
            "walnuts",
            "cashew milk",
            "peanuts",
            "pistachios",
            "shrimp",
            "clams",
            "oysters",
            "scallops",
            "pineapple",
            "nutmeg",
            "butternut squash",
        ]:
            with self.subTest(name=name):
                self.assertFalse(conflicts(name))

    def test_raw_name_and_prep_note_checked(self):
        ingredient = {
            "id": "vinegar",
            "name": "red wine vinegar",
            "name_raw": "apple cider vinegar",
        }
        self.assertEqual(unresolved([ingredient], []), [ingredient])
        self.assertEqual(
            len(unresolved([{"id": "salad", "name": "salad", "prep_note": "almond garnish"}], [])),
            1,
        )

    def test_replacement_must_be_specific_and_nonallergenic(self):
        for replacement in ["", "pears", "almond flour", "cherry jam"]:
            with self.assertRaises(ValueError):
                validate_change({"ingredient_id": "fruit", "replacement": replacement}, INGREDIENTS)
        with self.assertRaises(ValueError):
            validate_change({"ingredient_id": "unknown", "replacement": "berries"}, INGREDIENTS)

    def test_only_approved_change_resolves_conflict(self):
        state = initial()
        state["pending"] = validate_change(
            {"ingredient_id": "fruit", "replacement": "2 cups blueberries"}, INGREDIENTS
        )
        original = copy.deepcopy(state["ingredients"])
        self.assertTrue(unresolved(state["ingredients"], state["approved"]))
        approve(state)
        self.assertFalse(unresolved(state["ingredients"], state["approved"]))
        self.assertEqual(state["ingredients"], original)
        self.assertIsNone(state["pending"])

    def test_navigation_is_one_step_and_questions_dont_advance(self):
        self.assertEqual(advance(-1, 3, "next"), 0)
        self.assertEqual(advance(1, 3, "next"), 2)
        for action in ["question", "repeat", "pause", "propose"]:
            self.assertEqual(advance(1, 3, action), 1)
        self.assertEqual(advance(0, 3, "back"), 0)
        self.assertEqual(advance(3, 3, "next"), 3)

    def test_signed_state_cannot_be_modified(self):
        token = sign(initial(), SECRET)
        self.assertEqual(verify(token, SECRET)["recipe"], RECIPE)
        with self.assertRaises(ValueError):
            verify(token, "wrong-secret")
        with self.assertRaises(ValueError):
            verify(token[:-1] + ("0" if token[-1] != "0" else "1"), SECRET)

    def test_expired_state_only_restores_saved_preferences(self):
        state = initial()
        state["expires"] = time.time() - 1
        token = sign(state, SECRET)
        with self.assertRaises(ValueError):
            verify(token, SECRET)
        self.assertEqual(verify(token, SECRET, allow_expired=True)["recipe"], RECIPE)

    def test_recipe_edits_invalidate_saved_changes_but_row_order_doesnt(self):
        other = {"id": "sugar", "name": "sugar"}
        self.assertEqual(
            fingerprint(RECIPE, INGREDIENTS + [other]), fingerprint(RECIPE, [other] + INGREDIENTS)
        )
        edited = {**RECIPE, "instructions": ["Different instructions"]}
        self.assertNotEqual(fingerprint(RECIPE, INGREDIENTS), fingerprint(edited, INGREDIENTS))


class TurnTests(unittest.TestCase):
    def setUp(self):
        from food_everything.api import cooking

        self.api = cooking
        self.env = patch.dict(os.environ, {"COOKING_VARIANTS_ENABLED": "false"})
        self.env.start()
        self.db_patch = patch.object(cooking, "supabase_client")
        self.db = self.db_patch.start()
        self.model_patch = patch.object(cooking, "ask_model")
        self.model = self.model_patch.start()
        self.model.return_value = cooking.Decision(
            action="question", reply="What would you like to do?", proposal=None
        )
        self.setup_patch = patch.object(cooking, "understand_setup")
        self.setup = self.setup_patch.start()
        self.setup.side_effect = lambda state, text, subject: cooking.SetupAnswer(
            answered=True, answer=text, reply=""
        )

    def tearDown(self):
        self.env.stop()
        self.db_patch.stop()
        self.model_patch.stop()
        self.setup_patch.stop()

    def request(self, state, action="message", text="hello"):
        return self.api.handle_turn(
            self.api.Turn(recipe_id=RECIPE_ID, token=sign(state, SECRET), action=action, text=text),
            SECRET,
        )

    def test_new_sessions_always_ask_guests_and_restore_only_suggestions(self):
        state = initial()
        state["approved"] = [
            {"ingredient_id": "fruit", "original": "apples", "replacement": "berries", "note": ""}
        ]
        db = MagicMock()
        db.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = RECIPE
        db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = (
            INGREDIENTS
        )
        self.db.return_value = db
        request = self.api.Turn(
            recipe_id=RECIPE_ID, action="start", saved_token=sign(state, SECRET)
        )
        result = self.api.handle_turn(request, SECRET)
        restored = verify(result["token"], SECRET)
        self.assertEqual(result["reply"], self.api.welcome(RECIPE))
        self.assertFalse(result["paused"])
        self.assertEqual(restored["approved"], [])
        self.assertEqual(len(restored["saved"]), 1)
        self.model.assert_not_called()
        db.table.assert_any_call("recipes")
        self.assertEqual(db.table.call_count, 2)  # reads only; variants disabled

    def test_guests_before_equipment_before_cooking(self):
        state = initial()
        state["phase"] = "guests"
        result = self.request(state, text="One guest is vegan")
        updated = verify(result["token"], SECRET)
        self.assertEqual(updated["guests"], "One guest is vegan")
        self.assertEqual(updated["phase"], "equipment")
        self.assertEqual(updated["step"], -1)

    def test_ambiguous_okay_does_not_approve(self):
        state = initial()
        state["pending"] = validate_change(
            {"ingredient_id": "fruit", "replacement": "berries"}, INGREDIENTS
        )
        result = self.request(state, text="okay")
        self.assertIsNotNone(result["pending"])
        self.assertEqual(result["approved"], [])
        self.model.assert_not_called()

    def test_question_about_pending_substitution_retains_approval_gate(self):
        state = initial()
        state["pending"] = validate_change(
            {"ingredient_id": "fruit", "replacement": "berries"}, INGREDIENTS
        )
        self.model.return_value = self.api.Decision(
            action="question", reply="Blueberries will make the filling juicier.", proposal=None
        )
        result = self.request(state, text="How will blueberries affect the texture?")
        self.assertIn("juicier", result["reply"])
        self.assertIsNotNone(result["pending"])
        self.assertEqual(result["approved"], [])
        self.assertEqual(result["step"], -1)

    def test_saved_preferences_exclude_conversation_and_guest_answers(self):
        state = initial()
        state["history"] = [{"role": "user", "text": "Private conversation"}]
        result = self.api.present(state, "Ready", SECRET)
        saved = verify(result["saved_token"], SECRET, allow_expired=True)
        self.assertEqual(set(saved), {"recipe", "version", "approved", "expires"})

    def test_explicit_spoken_and_button_approval_preserve_original_and_never_write_db(self):
        for action, text in [
            ("approve", ""),
            ("message", "Approve substitution."),
            ("message", "Yes, please."),
        ]:
            state = initial()
            state["pending"] = validate_change(
                {"ingredient_id": "fruit", "replacement": "berries"}, INGREDIENTS
            )
            result = self.request(state, action, text)
            approved = verify(result["token"], SECRET)
            self.assertEqual(len(result["approved"]), 1)
            self.assertIsNone(result["pending"])
            self.assertEqual(approved["recipe"], RECIPE)
            self.assertEqual(approved["ingredients"], INGREDIENTS)
        self.db.assert_not_called()

    def test_rejection_and_pause_never_advance(self):
        state = initial()
        state["pending"] = validate_change(
            {"ingredient_id": "fruit", "replacement": "berries"}, INGREDIENTS
        )
        result = self.request(state, "reject", "")
        self.assertIsNone(result["pending"])
        self.assertEqual(result["approved"], [])
        result = self.request(state, text="pause")
        self.assertTrue(result["paused"])
        self.assertEqual(result["step"], -1)
        self.model.assert_not_called()

    def test_cannot_start_with_unresolved_conflicts_even_if_model_says_next(self):
        self.model.return_value = self.api.Decision(
            action="next", reply="Start cooking", proposal=None
        )
        result = self.request(initial(), text="next")
        self.assertEqual(result["step"], -1)
        self.assertIn("replacement", result["reply"])

    def test_question_and_repeat_dont_advance(self):
        state = initial()
        state["ingredients"] = []
        state["step"] = 1
        result = self.request(state, text="How hot should the oven be?")
        self.assertEqual(result["step"], 1)
        self.model.return_value = self.api.Decision(
            action="next", reply="Bake until done.", proposal=None
        )
        result = self.request(state, "repeat", "")
        self.assertEqual(result["step"], 1)

    def test_conversation_waits_for_each_setup_answer_then_advances_one_step(self):
        state = initial()
        state.update(phase="guests", ingredients=[])
        self.setup.side_effect = None
        self.setup.return_value = self.api.SetupAnswer(
            answered=False, answer="", reply="Does anyone have dietary restrictions?"
        )
        result = self.request(state, text="Okay")
        state = verify(result["token"], SECRET)
        self.assertEqual((state["phase"], state["step"]), ("guests", -1))
        self.model.assert_not_called()
        self.setup.return_value = self.api.SetupAnswer(answered=True, answer="none", reply="")
        self.model.return_value = self.api.Decision(
            action="question", reply="Do you have an oven and baking dish?", proposal=None
        )
        result = self.request(state, text="No restrictions")
        state = verify(result["token"], SECRET)
        self.assertEqual((state["phase"], state["step"]), ("equipment", -1))
        self.assertIn("oven", result["reply"])
        self.setup.return_value = self.api.SetupAnswer(
            answered=False, answer="", reply="Do you have a dish you can bake in?"
        )
        result = self.request(state, text="What size dish?")
        state = verify(result["token"], SECRET)
        self.assertEqual((state["phase"], state["step"]), ("equipment", -1))
        self.setup.return_value = self.api.SetupAnswer(
            answered=True, answer="oven and dish", reply=""
        )
        self.model.return_value = self.api.Decision(
            action="question", reply="Prepare the fruit. Tell me when you're ready.", proposal=None
        )
        result = self.request(state, text="Yes, I have those")
        state = verify(result["token"], SECRET)
        self.assertEqual((state["phase"], state["step"]), ("cooking", 0))
        result = self.request(state, text="Okay!")
        self.assertEqual(result["step"], 1)

    def test_voice_pause_persists_and_resume_repeats_same_step(self):
        state = initial()
        state.update(ingredients=[], step=0)
        result = self.request(state, text="Hold on.")
        state = verify(result["token"], SECRET)
        self.assertTrue(state["paused"])
        result = self.request(state, text="next")
        self.assertTrue(result["paused"])
        self.assertEqual(result["step"], 0)
        result = self.request(verify(result["token"], SECRET), text="Resume")
        self.assertFalse(result["paused"])
        self.assertEqual(result["step"], 0)

    def test_resume_during_setup_reasks_without_consuming_answer(self):
        for phase in ["guests", "equipment"]:
            state = initial()
            state.update(phase=phase, paused=True)
            result = self.request(state, text="Resume")
            self.assertFalse(result["paused"])
            self.assertEqual(result["phase"], phase)
            self.assertEqual(result["step"], -1)
        self.setup.assert_not_called()

    def test_session_cannot_be_used_for_another_recipe(self):
        state = initial()
        state["recipe"]["id"] = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
        with self.assertRaises(ValueError):
            self.request(state)

    def test_enabled_cloud_save_only_writes_separate_variant(self):
        state = initial()
        state["pending"] = validate_change(
            {"ingredient_id": "fruit", "replacement": "berries"}, INGREDIENTS
        )
        with patch.dict(os.environ, {"COOKING_VARIANTS_ENABLED": "true"}):
            self.request(state, "approve", "")
        self.db.return_value.table.assert_called_once_with("cooking_recipe_variants")

    def test_cloud_save_failure_keeps_session_approval(self):
        state = initial()
        state["pending"] = validate_change(
            {"ingredient_id": "fruit", "replacement": "berries"}, INGREDIENTS
        )
        self.db.return_value.table.side_effect = RuntimeError("database unavailable")
        with patch.dict(os.environ, {"COOKING_VARIANTS_ENABLED": "true"}):
            result = self.request(state, "approve", "")
        self.assertEqual(len(result["approved"]), 1)
        self.assertIn("failed", result["warning"])


class ConnectionTests(unittest.TestCase):
    def setUp(self):
        from food_everything.api import cooking

        self.api = cooking
        self.auth = patch.object(cooking, "authorize", return_value=SECRET)
        self.auth.start()
        self.provider = patch.object(cooking.requests, "post")
        self.post = self.provider.start()
        self.client = patch.object(cooking, "openai_client")
        self.client.start().return_value.api_key = "server-test-key"
        self.addCleanup(self.auth.stop)
        self.addCleanup(self.provider.stop)
        self.addCleanup(self.client.stop)
        self.req = cooking.LiveConnection(
            token=sign(initial(), SECRET), sdp="v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
        )

    def test_only_sdp_reaches_browser_and_transcription_credentials_stay_server_side(self):
        session, answer = MagicMock(), MagicMock()
        session.json.return_value = {"value": "ephemeral-test-key"}
        answer.text = "v=0\r\nm=audio provider-answer"
        self.post.side_effect = [session, answer]
        result = self.api.connect(self.req, "Bearer test")
        self.assertEqual(result, {"sdp": answer.text})
        create, negotiate = self.post.call_args_list
        self.assertEqual(create.args, ("https://api.openai.com/v1/realtime/client_secrets",))
        self.assertEqual(create.kwargs["json"]["session"]["type"], "transcription")
        self.assertEqual(create.kwargs["headers"]["Authorization"], "Bearer server-test-key")
        self.assertEqual(negotiate.args, ("https://api.openai.com/v1/realtime/calls",))
        self.assertEqual(negotiate.kwargs["headers"]["Authorization"], "Bearer ephemeral-test-key")
        self.assertEqual(negotiate.kwargs["data"], self.req.sdp)

    def test_invalid_state_or_sdp_never_calls_provider(self):
        from fastapi import HTTPException

        for req in [
            self.req.model_copy(update={"token": "tampered"}),
            self.req.model_copy(update={"sdp": "https://untrusted.example/audio"}),
        ]:
            with self.assertRaises(HTTPException) as error:
                self.api.connect(req)
            self.assertEqual(error.exception.status_code, 400)
        self.post.assert_not_called()

    def test_provider_errors_are_sanitized(self):
        from fastapi import HTTPException

        self.post.side_effect = RuntimeError("secret-upstream-request")
        with self.assertRaises(HTTPException) as error:
            self.api.connect(self.req)
        self.assertEqual(error.exception.status_code, 502)
        self.assertNotIn("secret-upstream", error.exception.detail)


if __name__ == "__main__":
    unittest.main()
