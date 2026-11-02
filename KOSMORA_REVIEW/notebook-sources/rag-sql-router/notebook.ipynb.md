# Исходные ячейки: rag-sql-router/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# RAG + SQL Router with Cleanlab Codex

This notebook demonstrates a (Text2SQL + RAG), hybrid agentic workflow

## Ячейка 1: markdown

## Setup and Configuration

## Ячейка 2: code

````text
import os

os.environ["CODEX_API_KEY"] = "<your_codex_api_key_here>"
````

## Ячейка 3: code

````text
import nest_asyncio

nest_asyncio.apply()
````

## Ячейка 4: markdown

## 🤖 LLM and Embedding Configuration

Configuring the language model (OpenRouter) and embedding model for semantic search capabilities

## Ячейка 5: code

````text
from llama_index.core import Settings
from llama_index.llms.openrouter import OpenRouter
from llama_index.embeddings.huggingface import HuggingFaceEmbedding

# Set the LLM and embedding model
Settings.llm = OpenRouter(api_key="<your_openrouter_api_key_here>", model="qwen/qwen-turbo")
Settings.embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-small-en-v1.5")
````

## Ячейка 6: markdown

## 🗄️ SQL Database Setup

## Ячейка 7: code

````text
from sqlalchemy import create_engine
from llama_index.core import SQLDatabase
from llama_index.core.query_engine import NLSQLTableQueryEngine

# Setup SQLite database
db_path = "city_database.sqlite"
engine = create_engine(f"sqlite:///{db_path}")
sql_database = SQLDatabase(engine)

# Create SQL query engine
sql_query_engine = NLSQLTableQueryEngine(sql_database=sql_database, tables=["city_stats"])
````

## Ячейка 8: markdown

## 📚 Document Query Engine Setup

Creating a vector-based document search system

## Ячейка 9: code

````text
from llama_index.vector_stores.milvus import MilvusVectorStore
from llama_index.core.node_parser import MarkdownNodeParser
from llama_index.readers.docling import DoclingReader
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, PromptTemplate, StorageContext

def create_docs_query_engine():
    # Initialize reader and parser
    reader = DoclingReader()
    node_parser = MarkdownNodeParser()

    # Load documents from directory
    loader = SimpleDirectoryReader(input_dir="data", file_extractor={".pdf": reader, ".docx": reader})
    docs = loader.load_data()

    # Initialize vector store and storage context
    vector_store = MilvusVectorStore(uri="http://localhost:19530", dim=384, overwrite=True)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    # Create vector index from documents
    vector_index = VectorStoreIndex.from_documents(
        docs,
        show_progress=True,
        transformations=[node_parser],
        storage_context=storage_context
    )

    # Define custom QA prompt
    template = (
        "You are a meticulous and accurate document analyst. Your task is to answer the user's question based exclusively on the provided context. "
        "Follow these rules strictly:\n"
        "1. Your entire response must be grounded in the facts provided in the 'Context' section. Do not use any prior knowledge.\n"
        "2. If multiple parts of the context are relevant, synthesize them into a single, coherent answer.\n"
        "3. If the context does not contain the information needed to answer the question, you must state only: 'The provided context does not contain enough information to answer this question.'\n"
        "-----------------------------------------\n"
        "Context: {context_str}\n"
        "-----------------------------------------\n"
        "Question: {query_str}\n\n"
        "Answer:"
    )
    qa_template = PromptTemplate(template)

    # Build and return query engine
    docs_query_engine = vector_index.as_query_engine(text_qa_template=qa_template, similarity_top_k=3)
    return docs_query_engine
````

## Ячейка 10: markdown

## 🛡️ Cleanlab Codex Integration

Setting up Cleanlab Codex for response validation

## Ячейка 11: code

````text
from cleanlab_codex.project import Project
from cleanlab_codex.client import Client

def create_codex_project():
    # Initialize Codex client and create a project
    codex_client = Client()
    project = codex_client.create_project(name="RAG + SQL")
    access_key = project.create_access_key("default key")
    project = Project.from_access_key(access_key)
    return project
````

## Ячейка 12: markdown

## 🚀 Initialize Components

Creating the core components:
1. **Document Query Engine**
2. **Codex Project**

## Ячейка 13: code

````text
# Create the query engine and project
docs_query_engine = create_docs_query_engine()
project = create_codex_project()
````

## Ячейка 14: markdown

## 🔍 Enhanced Document Query Function

This function combines traditional RAG with Codex validation

## Ячейка 15: code

````text
def document_query_tool(query: str):
    # Query the engine
    response_obj = docs_query_engine.query(query)
    initial_response = str(response_obj)

    # Gather source context
    context = response_obj.source_nodes
    context_str = "\n".join([n.node.text for n in context])

    # Prepare prompt for Codex validation
    prompt_template = (
        "You are a meticulous and accurate document analyst. Your task is to answer the user's question based exclusively on the provided context. "
        "Follow these rules strictly:\n"
        "1. Your entire response must be grounded in the facts provided in the 'Context' section. Do not use any prior knowledge.\n"
        "2. If multiple parts of the context are relevant, synthesize them into a single, coherent answer.\n"
        "3. If the context does not contain the information needed to answer the question, you must state only: 'The provided context does not contain enough information to answer this question.'\n"
        "-----------------------------------------\n"
        "Context: {context}\n"
        "-----------------------------------------\n"
        "Question: {query}\n\n"
        "Answer:"
    )
    user_prompt = prompt_template.format(context=context_str, query=query)
    messages = [{"role": "user", "content": user_prompt}]

    # Validate with Codex
    result = project.validate(
        messages=messages,
        query=query,
        context=context_str,
        response=initial_response,
    )

    # Final response selection
    fallback_response = "I'm sorry, I couldn't find answer — can I help with else?"
    final_response = (
        result.expert_answer
        if result.expert_answer and result.escalated_to_sme
        else fallback_response if result.should_guardrail
        else initial_response
    )

    return final_response
````

## Ячейка 16: markdown

## 🛠️ Tool Configuration

Creating specialized tools for the workflow system

## Ячейка 17: code

````text
from llama_index.core.tools import QueryEngineTool
from llama_index.core.tools import FunctionTool

# Create tools for SQL and document query engines
sql_tool = QueryEngineTool.from_defaults(
    query_engine=sql_query_engine,
    name="sql_tool",
    description=(
        "Useful for translating a natural language query into a SQL query over"
        " a table containing: city_stats, containing the population/state of"
        " each city located in the USA."
    ),
)

docs_tool = FunctionTool.from_defaults(
    document_query_tool,
    name="document_tool",
    description=(
        "Useful for answering a natural language question by performing a semantic search over "
        "a collection of documents. These documents may contain general knowledge, reports, "
        "or domain-specific content. Returns the most relevant passages or synthesized answers. "
        "If the user query does not relate to US city statistics (population and state), use this document search tool."
    ),
)
````

## Ячейка 18: markdown

## ⚡ Workflow System Architecture

Building a sophisticated routing workflow

## Ячейка 19: code

````text
from typing import Dict, List, Any, Optional
from llama_index.core.tools import BaseTool
from llama_index.core.llms import ChatMessage
from llama_index.core.llms.llm import ToolSelection, LLM
from llama_index.core.workflow import (
    Workflow,
    Event,
    StartEvent,
    StopEvent,
    step,
    Context,
)


class InputEvent(Event):
    """Input event."""


class GatherToolsEvent(Event):
    """Gather Tools Event"""

    tool_calls: Any


class ToolCallEvent(Event):
    """Tool Call event"""

    tool_call: ToolSelection


class ToolCallEventResult(Event):
    """Tool call event result."""

    msg: ChatMessage


class RouterOutputAgentWorkflow(Workflow):
    """Custom router output agent workflow."""

    def __init__(
        self,
        tools: List[BaseTool],
        timeout: Optional[float] = 10.0,
        disable_validation: bool = False,
        verbose: bool = False,
        llm: Optional[LLM] = None,
        chat_history: Optional[List[ChatMessage]] = None,
    ):
        """Constructor."""
        super().__init__(
            timeout=timeout, disable_validation=disable_validation, verbose=verbose
        )
        self.tools: List[BaseTool] = tools
        self.tools_dict: Optional[Dict[str, BaseTool]] = {
            tool.metadata.name: tool for tool in self.tools
        }
        self.llm: LLM = llm or Settings.llm
        self.chat_history: List[ChatMessage] = chat_history or []

    def reset(self) -> None:
        """Resets Chat History"""
        self.chat_history = []

    @step()
    async def prepare_chat(self, ev: StartEvent) -> InputEvent:
        message = ev.get("message")
        if message is None:
            raise ValueError("'message' field is required.")

        # Add message to chat history
        chat_history = self.chat_history
        chat_history.append(ChatMessage(role="user", content=message))
        return InputEvent()

    @step()
    async def chat(self, ev: InputEvent) -> GatherToolsEvent | StopEvent:
        """Appends msg to chat history, then gets tool calls."""
        try:
            # Put message into LLM with tools included
            chat_res = await self.llm.achat_with_tools(
                self.tools,
                chat_history=self.chat_history,
                verbose=self._verbose,
                allow_parallel_tool_calls=True,
            )
            tool_calls = self.llm.get_tool_calls_from_response(
                chat_res, error_on_no_tool_call=False
            )

            ai_message = chat_res.message
            self.chat_history.append(ai_message)
            if self._verbose:
                print(f"Chat message: {ai_message.content}")

            # No tool calls, return chat message.
            if not tool_calls:
                return StopEvent(result=ai_message.content)

            return GatherToolsEvent(tool_calls=tool_calls)
        except Exception as e:
            error_msg = f"Error during chat: {str(e)}"
            print(error_msg)
            return StopEvent(
                result="I'm sorry, I encountered an issue processing your request. Could you try asking in a different way?"
            )

    @step(pass_context=True)
    async def dispatch_calls(self, ctx: Context, ev: GatherToolsEvent) -> ToolCallEvent:
        """Dispatches calls."""
        tool_calls = ev.tool_calls
        await ctx.set("num_tool_calls", len(tool_calls))

        # Trigger tool call events
        for tool_call in tool_calls:
            ctx.send_event(ToolCallEvent(tool_call=tool_call))

        return None

    @step()
    async def call_tool(self, ev: ToolCallEvent) -> ToolCallEventResult:
        """Calls tool."""
        tool_call = ev.tool_call
        # Get tool ID and function call
        id_ = tool_call.tool_id

        if self._verbose:
            print(
                f"Calling function {tool_call.tool_name} with msg {tool_call.tool_kwargs}"
            )

        # Call function and put result into a chat message
        tool = self.tools_dict[tool_call.tool_name]
        output = await tool.acall(**tool_call.tool_kwargs)
        msg = ChatMessage(
            name=tool_call.tool_name,
            content=str(output),
            role="tool",
            additional_kwargs={"tool_call_id": id_, "name": tool_call.tool_name},
        )

        return ToolCallEventResult(msg=msg)

    @step(pass_context=True)
    async def gather(self, ctx: Context, ev: ToolCallEventResult) -> StopEvent | None:
        """Gathers tool calls."""
        # Wait for all tool call events to finish.
        tool_events = ctx.collect_events(
            ev, [ToolCallEventResult] * await ctx.get("num_tool_calls")
        )
        if not tool_events:
            return None

        for tool_event in tool_events:
            # Append tool call chat messages to history
            self.chat_history.append(tool_event.msg)

        # After all tool calls finish, pass input event back, restart agent loop
        return InputEvent()
````

## Ячейка 20: markdown

## 🎯 Workflow Initialization

Creating the main workflow instance with:
- **Tools**: SQL and Document query engines
- **Verbose Mode**: Enabled for detailed logging

## Ячейка 21: code

````text
# Initialize workflow with the given tools
wf = RouterOutputAgentWorkflow(tools=[sql_tool, docs_tool], verbose=True, timeout=120)
````

## Ячейка 22: markdown

## 📊 Workflow Visualization

## Ячейка 23: code

````text
from llama_index.utils.workflow import draw_all_possible_flows

# Draw the workflow diagram
draw_all_possible_flows(RouterOutputAgentWorkflow)
````

## Ячейка 24: markdown

## 🧪 Testing & Examples

## Ячейка 25: code

````text
from IPython.display import display, Markdown

result = await wf.run(message="What is the population of Houston, Texas?")
display(Markdown(result))
````

## Ячейка 26: code

````text
result = await wf.run(message="What is the weather in California?")
display(Markdown(result))
````