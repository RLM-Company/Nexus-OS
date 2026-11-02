# Исходные ячейки: simple-rag-workflow/evaluation.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import opik
opik.configure(use_local=False)
````

## Ячейка 1: code

````text
from dotenv import load_dotenv
load_dotenv()
````

## Ячейка 2: markdown

# Setup Workflow

## Ячейка 3: code

````text
from workflow import RAGWorkflow
import asyncio

def load_workflow(model_option):
    if model_option == "Gemma3":
        workflow = RAGWorkflow(model_name="gemma3")
    else:
        workflow = RAGWorkflow(model_name="llama3.2")
    return workflow
````

## Ячейка 4: code

````text
model_name = 'Gemma3'
# model_name = 'DeepSeek-R1'
workflow  = load_workflow(model_name)
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

## Ячейка 7: code

````text
await workflow.ingest_documents("./eval-data/paul_graham")
````

## Ячейка 8: code

````text
response = await workflow.query("Who is Paul Graham?")
print(response)
````

## Ячейка 9: markdown

# Evaluation

## Ячейка 10: code

````text
from opik import Opik

client = Opik()
dataset = client.get_or_create_dataset(name="Test dataset")
````

## Ячейка 11: code

````text
import pandas as pd

df = pd.read_csv("./eval-data/test.csv")
````

## Ячейка 12: code

````text
# insert the data into the dataset

qa_pairs = [
    {"input": row["Question"], "expected_output": row["Answer"], "context": row["Context"]} 
    for _, row in df.iterrows()
]
qa_pairs[0]

````

## Ячейка 13: code

````text
dataset.insert(qa_pairs)
````

## Ячейка 14: code

````text
from opik import track

@track
async def my_llm_application(input: str) -> str:
    response = await workflow.query(input)
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