# Исходные ячейки: document-chat-rag/rag_demo.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# RAG using Meta AI Llama-3.2


<img src="./resources/rag_architecture.png" width=800px>

## Ячейка 1: code

````text
import nest_asyncio
from IPython.display import Markdown, display

from llama_index.core import Settings
from llama_index.llms.ollama import Ollama
from llama_index.core import PromptTemplate
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core import VectorStoreIndex, ServiceContext, SimpleDirectoryReader, StorageContext
from llama_index.core.postprocessor import SentenceTransformerRerank
from llama_index.vector_stores.qdrant import QdrantVectorStore
from llama_index.core import Settings
import qdrant_client
````

## Ячейка 2: code

````text
# allows nested access to the event loop
nest_asyncio.apply()
````

## Ячейка 3: code

````text
# add your documents in this directory, you can drag & drop
input_dir_path = './docs'
````

## Ячейка 4: code

````text
collection_name="chat_with_docs"

client = qdrant_client.QdrantClient(
    host="localhost",
    port=6333
)

def create_index(documents):
    vector_store = QdrantVectorStore(client=client, collection_name=collection_name)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    index = VectorStoreIndex.from_documents(
        documents,
        storage_context=storage_context,
    )
    return index
````

## Ячейка 5: code

````text

# setup llm & embedding model and reranker
llm=Ollama(model="llama3.2:1b", request_timeout=120.0)
embed_model = HuggingFaceEmbedding( model_name="BAAI/bge-large-en-v1.5", trust_remote_code=True)
rerank = SentenceTransformerRerank(
    model="cross-encoder/ms-marco-MiniLM-L-2-v2", top_n=3
)
````

## Ячейка 6: code

````text
# load data
loader = SimpleDirectoryReader(
            input_dir = input_dir_path,
            required_exts=[".pdf"],
            recursive=True
        )
docs = loader.load_data()

# Creating an index over loaded data
Settings.embed_model = embed_model
try:
    index = create_index(docs)
    print('Using Qdrant collection')
except:
    index = VectorStoreIndex.from_documents(docs, show_progress=True)

# Create the query engine, where we use a cohere reranker on the fetched nodes
Settings.llm = llm
query_engine = index.as_query_engine(
    similarity_top_k=10, node_postprocessors=[rerank]
)

# ====== Customise prompt template ======
qa_prompt_tmpl_str = (
"Context information is below.\n"
"---------------------\n"
"{context_str}\n"
"---------------------\n"
"Given the context information above I want you to think step by step to answer the query in a crisp manner, incase case you don't know the answer say 'I don't know!'.\n"
"Query: {query_str}\n"
"Answer: "
)
qa_prompt_tmpl = PromptTemplate(qa_prompt_tmpl_str)

query_engine.update_prompts(
    {"response_synthesizer:text_qa_template": qa_prompt_tmpl}
)

# Generate the response
response = query_engine.query("What exactly is DSPy?",)
````

## Ячейка 7: code

````text
display(Markdown(str(response)))
````