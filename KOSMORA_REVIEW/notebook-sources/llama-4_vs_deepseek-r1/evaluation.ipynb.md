# Исходные ячейки: llama-4_vs_deepseek-r1/evaluation.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import opik
opik.configure(use_local=False)
````

## Ячейка 1: code

````text
from dotenv import load_dotenv
import nest_asyncio

nest_asyncio.apply()
load_dotenv()
````

## Ячейка 2: markdown

# Setup Workflow

## Ячейка 3: code

````text
import os
from llama_index.llms.groq import Groq

def load_llm(model_option):
    if model_option == "Llama-4":
        llm = Groq(model="meta-llama/llama-4-scout-17b-16e-instruct", api_key=os.getenv("GROQ_API_KEY"))
    else:
        llm = Groq(model="deepseek-r1-distill-llama-70b", api_key=os.getenv("GROQ_API_KEY"))
    return llm
````

## Ячейка 4: code

````text
model_name = 'Llama-4'
# model_name = 'DeepSeek-R1'
llm  = load_llm(model_name)
````

## Ячейка 5: markdown

# Trace RAG calls 

## Ячейка 6: code

````text
from llama_index.core import Settings
from llama_index.core.callbacks import CallbackManager
from opik.integrations.llama_index import LlamaIndexCallbackHandler

# A callback handler tp automatically log all LlamaIndex operations to Opik
opik_callback_handler = LlamaIndexCallbackHandler()

# Integrate handler into LlamaIndex's settings
Settings.callback_manager = CallbackManager([opik_callback_handler])
````

## Ячейка 7: markdown

# Evaluation

## Ячейка 8: code

````text
from opik import Opik

client = Opik()
dataset = client.get_or_create_dataset(name="Test dataset")
````

## Ячейка 9: code

````text
import pandas as pd

df = pd.read_csv("./eval-data/test.csv")
````

## Ячейка 10: code

````text
# insert the data into the dataset

qa_pairs = [
    {"input": row["Question"], "expected_output": row["Answer"], "context": row["Context"]} 
    for _, row in df.iterrows()
]
qa_pairs[0]

````

## Ячейка 11: markdown

Use insert if you're creating the dataset for the first time

## Ячейка 12: code

````text

# dataset.insert(qa_pairs)
````

## Ячейка 13: code

````text
from llama_index.embeddings.fastembed import FastEmbedEmbedding
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader


Settings.llm = llm
Settings.embed_model = FastEmbedEmbedding(model_name="nomic-ai/nomic-embed-text-v1")

documents = SimpleDirectoryReader("./eval-data/paul_graham").load_data()
index = VectorStoreIndex.from_documents(documents)

query_engine = index.as_query_engine()
````

## Ячейка 14: code

````text
from opik import track

@track
def my_llm_application(input: str) -> str:
    response = query_engine.query(input)
    return str(response)

def evaluation_task(x):
    return {
        "output": my_llm_application(x['input'])
    }
````

## Ячейка 15: code

````text
from opik.evaluation.metrics import (
    Hallucination,
    AnswerRelevance,
    ContextPrecision,
    ContextRecall
)

# Define the metrics
hallucination_metric = Hallucination()
answer_relevance_metric = AnswerRelevance()
context_precision_metric = ContextPrecision()
context_recall_metric = ContextRecall() 
````

## Ячейка 16: code

````text
from opik.evaluation import evaluate

evaluation = evaluate(
    dataset=dataset,
    task=evaluation_task,
    experiment_name = model_name,
    scoring_metrics=[hallucination_metric, answer_relevance_metric, context_precision_metric, context_recall_metric],
    experiment_config={
        "model": "gpt-3.5-turbo"
    }
)
````

## Ячейка 17: code

````text

````