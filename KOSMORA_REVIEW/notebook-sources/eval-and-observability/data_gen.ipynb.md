# Исходные ячейки: eval-and-observability/data_gen.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

## Automated RAG evaluation data generation

## Ячейка 1: code

````text
import pandas as pd

from langchain_community.llms import Ollama
from langchain.document_loaders import DirectoryLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_community.embeddings import OllamaEmbeddings


from ragas.testset.generator import TestsetGenerator
from ragas.testset.evolutions import simple, reasoning, multi_context
````

## Ячейка 2: code

````text
pd.set_option("display.max_colwidth", None)
````

## Ячейка 3: markdown

### Load & chunk data to create document objects

## Ячейка 4: code

````text
loader = DirectoryLoader("./paul_graham")
text_splitter = RecursiveCharacterTextSplitter(chunk_size=1024, chunk_overlap=20)
documents = loader.load_and_split(text_splitter)
````

## Ячейка 5: code

````text
len(documents)
````

## Ячейка 6: markdown

### Add `filename` attribute to document 
The `filename` attribute in metadata is used to identify chunks belonging to the same document. For instance, pages belonging to the same research publication can be identified using the filename.

## Ячейка 7: code

````text
for document in documents:
    document.metadata['filename'] = document.metadata['source']

documents[0].to_json()
````

## Ячейка 8: markdown

### Setting up the Generator, Critic & embedding models

## Ячейка 9: code

````text
generator_llm = Ollama(model="phi3")
critic_llm = Ollama(model="llama3")

ollama_emb = OllamaEmbeddings(
    model="nomic-embed-text",
)

print(generator_llm.invoke('Say hello'))
print(critic_llm.invoke('Say hello'))

r2 = ollama_emb.embed_query(
    "What is the second letter of Greek alphabet"
)

print(f'Embedding dimension: {len(r2)}')
````

## Ячейка 10: markdown

### Create a test generator object

## Ячейка 11: code

````text
generator = TestsetGenerator.from_langchain(
    generator_llm=generator_llm,
    critic_llm=critic_llm,
    embeddings=ollama_emb
)

# generate testset
testset = generator.generate_with_langchain_docs(documents, test_size=10, distributions={simple: 0.5, reasoning: 0.25, multi_context: 0.25}, raise_exceptions=False)
````

## Ячейка 12: markdown

### Load testset as a dataframe

## Ячейка 13: code

````text
test_df = testset.to_pandas().dropna()
test_df.head()
````

## Ячейка 14: code

````text
test_df.to_csv('test_data_ollama.csv')
test_df
````

## Ячейка 15: code

````text
len(test_df)
````

## Ячейка 16: code

````text

````