# Исходные ячейки: fastest-rag-stack/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# RAG using SambaNova and Meta AI Llama-3 


<img src="./resources/thumbnail.png" width=800px>

## Ячейка 1: code

````text
import os
import openai

import nest_asyncio
from dotenv import load_dotenv
from IPython.display import Markdown, display

from llama_index.core import Settings
from llama_index.llms.ollama import Ollama
from llama_index.core import PromptTemplate
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core import VectorStoreIndex, ServiceContext, SimpleDirectoryReader

from llama_index.llms.sambanovasystems import SambaNovaCloud

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
input_dir_path = '/teamspace/studios/this_studio/test-dir'
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

# setup llm & embedding model
llm = SambaNovaCloud(model="Meta-Llama-3.3-70B-Instruct", temperature=0.7, top_p=0.01)

embed_model = HuggingFaceEmbedding( model_name="BAAI/bge-large-en-v1.5", trust_remote_code=True)
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
query_engine = index.as_query_engine()

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

## Ячейка 8: markdown

### ❗️❗️ Make sure you clear GPU memory by clicking on Restart button above, if you want to use Streamlit from here

## Ячейка 9: code

````text
# check GPU usage

!nvidia-smi
````

## Ячейка 10: code

````text
!pip install llama-index-vector-stores-qdrant
!pip install llama-index qdrant_client
````

## Ячейка 11: code

````text
import os
from llama_index.llms.sambanovasystems import SambaNovaCloud
from dotenv import load_dotenv

load_dotenv()

os.getenv("SAMBANOVA_API_KEY")
````

## Ячейка 12: code

````text
llm = SambaNovaCloud(model="Meta-Llama-3.3-70B-Instruct",
                     temperature=0.7,
                     top_p=0.01,
                    )
````

## Ячейка 13: code

````text

from llama_index.core.base.llms.types import (
    ChatMessage,
    MessageRole,
)
````

## Ячейка 14: code

````text
system_msg = ChatMessage(
    role=MessageRole.SYSTEM,
    content="You are a helpful assistant that translates English to French. Translate the user sentence.",
)
user_msg = ChatMessage(role=MessageRole.USER, content="I love programming.")

messages = [
    system_msg,
    user_msg,
]

response = llm.chat(messages)
print(response.message)
````

## Ячейка 15: code

````text
from rag_code import *
from llama_index.core import SimpleDirectoryReader
````

## Ячейка 16: code

````text
batch_size=32
loader = SimpleDirectoryReader(input_dir = "./docs/",
                               required_exts=[".pdf"],
                               recursive=True)

docs = loader.load_data()
documents = [doc.text for doc in docs]

# embed data    

embeddata = EmbedData(embed_model_name="BAAI/bge-large-en-v1.5", batch_size=batch_size)
embeddata.embed(documents)

# set up vector database
qdrant_vdb = QdrantVDB_QB(collection_name="chat-with-docs2",
                          batch_size=batch_size,
                          vector_dim=1024)

qdrant_vdb.define_client()
qdrant_vdb.create_collection()
qdrant_vdb.ingest_data(embeddata=embeddata)

# set up retriever
retriever = Retriever(vector_db=qdrant_vdb, embeddata=embeddata)

# set up rag
query_engine = RAG(retriever=retriever, llm_name="Meta-Llama-3.3-70B-Instruct")

````

## Ячейка 17: code

````text
messages = query_engine.query("What is DSPy?")
````

## Ячейка 18: code

````text
messages
````

## Ячейка 19: code

````text
# system_msg = ChatMessage(
#     role=MessageRole.SYSTEM,
#     content="You are a helpful assistant that translates English to French. Translate the user sentence.",
# )


# messages_new = [
#     system_msg,
#     user_msg,
# ]



````

## Ячейка 20: code

````text
full_response = ""
        
user_msg = ChatMessage(role=MessageRole.USER, content="I love programming.")

# Simulate stream of response with milliseconds delay
streaming_response = query_engine.llm.stream_complete(user_msg.content)

for chunk in streaming_response:
    try:
        new_text = chunk.raw["choices"][0]["delta"]["content"]
        full_response += new_text
        print(new_text)
    except:
        pass
````

## Ячейка 21: code

````text
ai_stream_msgs[7].raw["choices"][0]["delta"]["content"]
````

## Ячейка 22: code

````text
ai_stream_msgs[7])
````

## Ячейка 23: code

````text
full_response = ""
        
# Simulate stream of response with milliseconds delay
streaming_response = query_engine.llm.stream_chat(messages)
        
for chunk in streaming_response:
    full_response += chunk
    message_placeholder.markdown(full_response + "▌")

ai_stream_msgs = []
for stream in streaming_response:
    ai_stream_msgs.append(stream)
````

## Ячейка 24: code

````text
ai_stream_msgs[-1]
````

## Ячейка 25: code

````text
print(messages[1].content)
````

## Ячейка 26: code

````text

````