# Исходные ячейки: Website-to-API-with-FireCrawl/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
!pip install -U firecrawl
````

## Ячейка 1: code

````text
import os
from firecrawl import FirecrawlApp
from dotenv import load_dotenv
import pandas as pd
from typing import Dict, Any
from pydantic import BaseModel
import time

class WebsiteScraper:
    def __init__(self):
        load_dotenv()
        self.firecrawl_api_key = os.getenv("FIRECRAWL_API_KEY")
        self.app = FirecrawlApp(api_key=self.firecrawl_api_key)
        self.schema_fields = [{"name": "", "type": "str"}]

    def create_dynamic_model(self, fields):
        """Create a dynamic Pydantic model from schema fields."""
        field_annotations = {}
        for field in fields:
            if field["name"]:
                type_mapping = {
                    "str": str,
                    "bool": bool,
                    "int": int,
                    "float": float
                }
                field_annotations[field["name"]] = type_mapping[field["type"]]
        
        return type(
            "ExtractSchema",
            (BaseModel,),
            {
                "__annotations__": field_annotations
            }
        )

    def create_schema_from_fields(self, fields):
        """Create schema using Pydantic model."""
        if not any(field["name"] for field in fields):
            return None
        
        model_class = self.create_dynamic_model(fields)
        return model_class.model_json_schema()

    def convert_to_table(self, data: Dict[str, Any]) -> str:
        """Convert data to a pandas DataFrame and return as string."""
        if not data or 'data' not in data:
            return ""
        
        df = pd.DataFrame([data['data']])
        return df.to_string(index=False)

    def scrape_website(self, website_url: str, prompt: str, schema_fields=None):
        """Main function to scrape website data."""
        if not website_url:
            raise ValueError("Please provide a website URL")

        try:
            schema = self.create_schema_from_fields(schema_fields) if schema_fields else None
            
            extract_params = {'prompt': prompt}
            if schema:
                extract_params['schema'] = schema

            data = self.app.extract([website_url,],
                                    extract_params
                                    )
            
            return data
            
        except Exception as e:
            raise Exception(f"An error occurred: {str(e)}")
````

## Ячейка 2: code

````text
scraper = WebsiteScraper()
    
# Get user input
website_url = "https://blog.dailydoseofds.com/*"
prompt = "extract publish date, title and link of all articles related to LLMs"
    
# Optional: Add schema fields
schema_fields = [
    {"name": "Article_title", "type": "str"},
    {"name": "Publish_date", "type": "str"},
    {"name": "Article_link", "type": "str"}
]

# Get results
result = scraper.scrape_website(website_url, prompt, [])
print("Results:\n")
print(result)
````

## Ячейка 3: code

````text
result['data']
````

## Ячейка 4: code

````text
class ExtractSchema(BaseModel):
    mission: str
    supports_sso: bool
    is_open_source: bool
    is_in_yc: bool
````

## Ячейка 5: code

````text
ExtractSchema.model_json_schema()
````

## Ячейка 6: code

````text
scraper.create_schema_from_fields(schema_fields)
````

## Ячейка 7: code

````text
from firecrawl import FirecrawlApp
from pydantic import BaseModel, Field

# Initialize the FirecrawlApp with your API key
app = FirecrawlApp(api_key=os.getenv("FIRECRAWL_API_KEY"))

class ExtractSchema(BaseModel):
    article_title: str
    publish_date: str
    article_link: str

data = app.extract([
  "https://blog.dailydoseofds.com/*"], {
    'prompt': 'Extract the article title, publish date, and article link of all articles related to LLMs.',
    'schema': ExtractSchema.model_json_schema(),
})
print(data)

````

## Ячейка 8: code

````text

````