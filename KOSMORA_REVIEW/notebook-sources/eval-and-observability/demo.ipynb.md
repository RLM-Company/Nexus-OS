# Исходные ячейки: eval-and-observability/demo.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Evaluation and observability for LLM applications


## Ячейка 1: markdown

## Creating an account on Comet.com

[Comet](https://www.comet.com/site?from=llm&utm_source=opik&utm_medium=colab&utm_content=llamaindex&utm_campaign=opik) provides a hosted version of the Opik platform, [simply create an account](https://www.comet.com/signup?from=llm&=opik&utm_medium=colab&utm_content=llamaindex&utm_campaign=opik) and grab you API Key.

> You can also run the Opik platform locally, see the [installation guide](https://www.comet.com/docs/opik/self-host/overview/?from=llm&utm_source=opik&utm_medium=colab&utm_content=llamaindex&utm_campaign=opik) for more information.

## Ячейка 2: code

````text
# !pip install opik llama-index llama-index-agent-openai llama-index-llms-openai --upgrade --quiet
````

## Ячейка 3: code

````text
import opik

opik.configure(use_local=False)
````

## Ячейка 4: markdown

## Preparing our environment

## Ячейка 5: markdown

#### Create a .env file with the following content:
> OPENAI_API_KEY=your-api-key-here

> COMET_API_KEY=your-comet-api-key-here


## Ячейка 6: code

````text
from dotenv import load_dotenv

load_dotenv()
````

## Ячейка 7: markdown

## Download some sample documents

## Ячейка 8: code

````text
import os
import requests

# Create directory if it doesn't exist
os.makedirs("./data/paul_graham/", exist_ok=True)

# Download the file using requests
url = "https://raw.githubusercontent.com/run-llama/llama_index/main/docs/docs/examples/data/paul_graham/paul_graham_essay.txt"
response = requests.get(url)
with open("./data/paul_graham/paul_graham_essay.txt", "wb") as f:
    f.write(response.content)
````

## Ячейка 9: markdown

## Simple demo of logging with Opik

## Ячейка 10: code

````text
from opik import track

@track
def my_function(x: int) -> int:
    return x + 1

my_function(1)
````

## Ячейка 11: markdown

## Tracking LLM calls with Opik

## Ячейка 12: code

````text
from opik.integrations.openai import track_openai
from openai import OpenAI

openai_client = OpenAI()
openai_client = track_openai(openai_client)

prompt="Hello, world!"

response = openai_client.chat.completions.create(
    model="gpt-3.5-turbo",
    messages=[
      {"role":"user", "content":prompt}
    ]
)

print(response.choices[0].message.content)
````

## Ячейка 13: markdown

## Using LlamaIndex

### Configuring the Opik <> LlamaIndex integration

## Ячейка 14: markdown

You can use the Opik callback directly by calling:

## Ячейка 15: code

````text
from llama_index.core import Settings
from llama_index.core.callbacks import CallbackManager
from opik.integrations.llama_index import LlamaIndexCallbackHandler

# Set up a callback handler that will automatically log all LlamaIndex operations to Opik
opik_callback_handler = LlamaIndexCallbackHandler()

# Integrating this handler into LlamaIndex's settings
Settings.callback_manager = CallbackManager([opik_callback_handler])
````

## Ячейка 16: markdown

Now that the callback handler is configured, all traces will automatically be logged to Opik.

## Ячейка 17: markdown

## Setup a simple LLamaIndex RAG pipeline

## Ячейка 18: code

````text
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

documents = SimpleDirectoryReader("./data/paul_graham").load_data()
index = VectorStoreIndex.from_documents(documents)
query_engine = index.as_query_engine()
````

## Ячейка 19: markdown

We can now query the index using the `query_engine` object:

## Ячейка 20: code

````text
response = query_engine.query("What did the author do growing up?") 
print(response)
````

## Ячейка 21: markdown

You can now go to the Opik app to see the trace:

![LlamaIndex trace in Opik](https://raw.githubusercontent.com/comet-ml/opik/main/apps/opik-documentation/documentation/static/img/cookbook/llamaIndex_cookbook.png)

## Ячейка 22: code

````text
str(response)
````

## Ячейка 23: markdown

## Prepare data for evaluation

## Ячейка 24: markdown

#### Load dataset and insert into Opik

## Ячейка 25: code

````text
import pandas as pd
pd.set_option("display.max_colwidth", None)

df = pd.read_csv("data/test.csv")
df.head()
````

## Ячейка 26: markdown

Create a dataset client


## Ячейка 27: code

````text
from opik import Opik

client = Opik()
dataset = client.get_or_create_dataset(name="Test dataset")
````

## Ячейка 28: markdown

Insert

## Ячейка 29: code

````text
qa_pairs = [
    {"input": row["Question"], "expected_output": row["Answer"], "context": row["Context"]} 
    for _, row in df.iterrows()
]
qa_pairs[0]
````

## Ячейка 30: code

````text

dataset.insert(qa_pairs)
````

## Ячейка 31: markdown

## Evaluation

## Ячейка 32: markdown

LLM application

## Ячейка 33: code

````text
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader

documents = SimpleDirectoryReader("./data/paul_graham").load_data()
index = VectorStoreIndex.from_documents(documents)

query_engine = index.as_query_engine()
````

## Ячейка 34: markdown

Track it with Opik

## Ячейка 35: code

````text
from opik import track

@track
def my_llm_application(input: str) -> str:
    response = query_engine.query(input)
    return str(response)
````

## Ячейка 36: markdown

Track the LLM calls

## Ячейка 37: code

````text
import openai
from opik.integrations.openai import track_openai

# Define the task to evaluate
openai_client = track_openai(openai.OpenAI())

MODEL = "gpt-3.5-turbo"
````

## Ячейка 38: markdown

Define the evaluation task

## Ячейка 39: code

````text
def evaluation_task(x):
    return {
        "output": my_llm_application(x['input'])
    }
````

## Ячейка 40: markdown

Create a dataset client


## Ячейка 41: code

````text
from opik import Opik

client = Opik()
dataset = client.get_or_create_dataset(name="Test dataset")
````

## Ячейка 42: markdown

Define evaluation metrics

## Ячейка 43: code

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

## Ячейка 44: markdown

Run evaluation

## Ячейка 45: code

````text
from opik.evaluation import evaluate

evaluation = evaluate(
    dataset=dataset,
    task=evaluation_task,
    scoring_metrics=[hallucination_metric, answer_relevance_metric, context_precision_metric, context_recall_metric],
    experiment_config={
        "model": MODEL
    }
)
````