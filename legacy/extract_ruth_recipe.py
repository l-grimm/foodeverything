import requests
from bs4 import BeautifulSoup

url = 'https://ruthreichl.substack.com/p/she-changed-the-way-we-think-about'
headers = {'User-Agent': 'Mozilla/5.0'}
response = requests.get(url, headers=headers)
soup = BeautifulSoup(response.text, 'html.parser')

# Extract the article content
article = soup.find('article')
for tag in article.select('.subscribe, footer, nav'):
    tag.decompose()

# Convert to clean text
clean_text = article.get_text(separator='\n\n').strip()

# Show a preview
print(clean_text[:3000])
