# Исходные ячейки: trustworthy-rag/main.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
# !pip install llama-index-llms-cleanlab llama-index llama-index-embeddings-huggingface
````

## Ячейка 1: markdown

Setup LLM

## Ячейка 2: code

````text
import os
from dotenv import load_dotenv
load_dotenv()

from llama_index.llms.cleanlab import CleanlabTLM


options = {
    "model": "gpt-4o",
    "max_tokens": 256,
    "log": ["explanation"],
}

llm = CleanlabTLM(api_key=os.environ["CLEANLAB_API_KEY"], options=options)
````

## Ячейка 3: code

````text
response = llm.complete("What is NVIDIA's ticker symbol?")
print(response)
````

## Ячейка 4: code

````text
response.additional_kwargs
````

## Ячейка 5: code

````text
from llama_index.core import Settings
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

from utils import (
    setup_trustworthiness_handler,
    display_response
)


Settings.llm = llm
````

## Ячейка 6: code

````text
Settings.embed_model = HuggingFaceEmbedding(
    model_name="BAAI/bge-small-en-v1.5"
)
````

## Ячейка 7: code

````text
from typing import Dict, List, ClassVar
from llama_index.core.instrumentation.events import BaseEvent
from llama_index.core.instrumentation.event_handlers import BaseEventHandler
from llama_index.core.instrumentation import get_dispatcher
from llama_index.core.instrumentation.events.llm import LLMCompletionEndEvent


class GetTrustworthinessScoreAndReasoning(BaseEventHandler):
    events: ClassVar[List[BaseEvent]] = []
    trustworthiness_score: float = 0.0
    reasoning: str = ""

    @classmethod
    def class_name(cls) -> str:
        """Class name."""
        return "GetTrustworthinessScoreAndReasoning"

    def handle(self, event: BaseEvent) -> Dict:
        if isinstance(event, LLMCompletionEndEvent):
            self.trustworthiness_score = event.response.additional_kwargs[
                "trustworthiness_score"
            ]
            self.reasoning = event.response.additional_kwargs[
                "explanation"
            ]
            self.events.append(event)


# Root dispatcher
root_dispatcher = get_dispatcher()

# Register event handler
event_handler = GetTrustworthinessScoreAndReasoning()
root_dispatcher.add_event_handler(event_handler)

def display_response(response):
    response_str = response.response
    trustworthiness_score = event_handler.trustworthiness_score
    reasoning = event_handler.reasoning
    print(f"Response: {response_str}")
    print(f"Trustworthiness score: {round(trustworthiness_score, 2)}")
    print(f"Reasoning: {reasoning}")

````

## Ячейка 8: code

````text
# Optional: Define `display_response` helper function


# This method presents formatted responses from our TLM-based RAG pipeline. It parses the output to display both the text response itself and the corresponding trustworthiness score.

````

## Ячейка 9: code

````text
# LlamaParse PDF reader for PDF Parsing
from llama_parse import LlamaParse

documents = LlamaParse(result_type="markdown").load_data(
    "/Users/akshay/Eigen/ai-engineering-hub/trustworthy-rag/docs/dspy.pdf"
)
# Started parsing the file under job_id b76a572b-d2bb-42ae-bad9-b9810049f1af
````

## Ячейка 10: code

````text
index = VectorStoreIndex.from_documents(documents)
````

## Ячейка 11: code

````text
query_engine = index.as_query_engine()
````

## Ячейка 12: code

````text
response = query_engine.query("What is is DSPy?")
print(response)
````

## Ячейка 13: code

````text
display_response(response)
````

## Ячейка 14: code

````text

````