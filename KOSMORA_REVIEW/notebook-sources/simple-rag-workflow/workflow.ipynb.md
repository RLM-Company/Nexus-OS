# Исходные ячейки: simple-rag-workflow/workflow.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import nest_asyncio
nest_asyncio.apply()
````

## Ячейка 1: code

````text
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from llama_index.core.settings import Settings

llm = Ollama(model="llama3.2")
embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-small-en-v1.5")

Settings.llm = llm
Settings.embed_model = embed_model
````

## Ячейка 2: code

````text
from llama_index.core.workflow import Event
from llama_index.core.schema import NodeWithScore


class RetrieverEvent(Event):
    """Result of running retrieval"""

    nodes: list[NodeWithScore]
````

## Ячейка 3: code

````text
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex
from llama_index.core.response_synthesizers import CompactAndRefine
from llama_index.core.workflow import (
    Context,
    Workflow,
    StartEvent,
    StopEvent,
    step,
)

class RAGWorkflow(Workflow):
    @step
    async def ingest(self, ctx: Context, ev: StartEvent) -> StopEvent | None:
        """Entry point to ingest a document, triggered by a StartEvent with `dirname`."""
        dirname = ev.get("dirname")
        if not dirname:
            return None

        documents = SimpleDirectoryReader(dirname).load_data()
        index = VectorStoreIndex.from_documents(
            documents=documents,
        )
        return StopEvent(result=index)

    @step
    async def retrieve(
        self, ctx: Context, ev: StartEvent
    ) -> RetrieverEvent | None:
        "Entry point for RAG, triggered by a StartEvent with `query`."
        query = ev.get("query")
        index = ev.get("index")

        if not query:
            return None

        print(f"Query the database with: {query}")

        # store the query in the global context
        await ctx.set("query", query)

        # get the index from the global context
        if index is None:
            print("Index is empty, load some documents before querying!")
            return None

        retriever = index.as_retriever(similarity_top_k=2)
        nodes = await retriever.aretrieve(query)
        print(f"Retrieved {len(nodes)} nodes.")
        return RetrieverEvent(nodes=nodes)

    @step
    async def synthesize(self, ctx: Context, ev: RetrieverEvent) -> StopEvent:
        """Return a streaming response using reranked nodes."""
        # llm = OpenAI(model="gpt-4o-mini")
        # summarizer = CompactAndRefine(llm=llm, streaming=True, verbose=True)
        summarizer = CompactAndRefine(streaming=True, verbose=True)
        query = await ctx.get("query", default=None)

        response = await summarizer.asynthesize(query, nodes=ev.nodes)
        return StopEvent(result=response)
````

## Ячейка 4: markdown

The first entrypoint is ingestion

## Ячейка 5: code

````text
w = RAGWorkflow()

# Ingest the documents
index = await w.run(dirname="data")
````

## Ячейка 6: markdown

The second entry point is retrieval

## Ячейка 7: code

````text
# Run a query
result = await w.run(query="How was DeepSeekR1 trained?", index=index)
async for chunk in result.async_response_gen():
    print(chunk, end="", flush=True)
````

## Ячейка 8: code

````text

````