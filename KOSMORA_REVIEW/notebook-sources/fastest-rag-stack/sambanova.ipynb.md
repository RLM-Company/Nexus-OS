# Исходные ячейки: fastest-rag-stack/sambanova.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
from dotenv import load_dotenv
from llama_index.llms.sambanovasystems import SambaNovaCloud

load_dotenv()

MODEL = "Meta-Llama-3.1-405B-Instruct"

llm = SambaNovaCloud(model=MODEL)
````

## Ячейка 1: code

````text
query = "write about the history of AI"

streaming_response = llm.stream_complete(query)

for chunk in streaming_response:
    try:
        print(chunk.raw["choices"][0]["delta"]["content"], end="", flush=True)
    except: 
        pass
````

## Ячейка 2: code

````text

````