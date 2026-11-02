# Исходные ячейки: llamaindex-mcp/ollama_client.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Building a Local MCP Client with LlamaIndex

This Jupyter notebook walks you through creating a **local MCP (Model Context Protocol) client** that can chat with a database through tools exposed by an MCP server—completely on your machine. Follow the cells in order for a smooth, self‑contained tutorial.

## Ячейка 1: code

````text
import nest_asyncio
nest_asyncio.apply()
````

## Ячейка 2: markdown

## 2  Setup a local LLM

## Ячейка 3: code

````text
from llama_index.llms.ollama import Ollama
from llama_index.core import Settings

llm = Ollama(model="llama3.2", request_timeout=120.0)
Settings.llm = llm
````

## Ячейка 4: markdown

## 3  Initialize the MCP client and build the agent
Point the client at your local MCP server’s **SSE endpoint** (default shown below), and list the available tools.

## Ячейка 5: code

````text
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec

mcp_client = BasicMCPClient("http://127.0.0.1:8000/sse")
mcp_tools = McpToolSpec(client=mcp_client) # you can also pass list of allowed tools
````

## Ячейка 6: code

````text
tools = await mcp_tools.to_tool_list_async()
for tool in tools:
    print(tool.metadata.name, tool.metadata.description)
````

## Ячейка 7: markdown

## 3  Define the system prompt
This prompt steers the LLM when it needs to decide how and when to call tools.

## Ячейка 8: code

````text
SYSTEM_PROMPT = """\
You are an AI assistant for Tool Calling.

Before you help a user, you need to work with tools to interact with Our Database
"""
````

## Ячейка 9: markdown

## 4  Helper function: `get_agent()`
Creates a `FunctionAgent` wired up with the MCP tool list and your chosen LLM.

## Ячейка 10: code

````text
from llama_index.tools.mcp import McpToolSpec
from llama_index.core.agent.workflow import FunctionAgent

async def get_agent(tools: McpToolSpec):
    tools = await tools.to_tool_list_async()
    agent = FunctionAgent(
        name="Agent",
        description="An agent that can work with Our Database software.",
        tools=tools,
        llm=OpenAI(model="gpt-4"),
        system_prompt=SYSTEM_PROMPT,
    )
    return agent
````

## Ячейка 11: markdown

## 5  Helper function: `handle_user_message()`
Streams intermediate tool calls (for transparency) and returns the final response.

## Ячейка 12: code

````text
from llama_index.core.agent.workflow import (
    FunctionAgent, 
    ToolCallResult, 
    ToolCall)

from llama_index.core.workflow import Context

async def handle_user_message(
    message_content: str,
    agent: FunctionAgent,
    agent_context: Context,
    verbose: bool = False,
):
    handler = agent.run(message_content, ctx=agent_context)
    async for event in handler.stream_events():
        if verbose and type(event) == ToolCall:
            print(f"Calling tool {event.tool_name} with kwargs {event.tool_kwargs}")
        elif verbose and type(event) == ToolCallResult:
            print(f"Tool {event.tool_name} returned {event.tool_output}")

    response = await handler
    return str(response)
````

## Ячейка 13: markdown

## 6  Initialize the MCP client and build the agent
Point the client at your local MCP server’s **SSE endpoint** (default shown below), build the agent, and setup agent context.

## Ячейка 14: code

````text
from llama_index.tools.mcp import BasicMCPClient, McpToolSpec


mcp_client = BasicMCPClient("http://127.0.0.1:8000/sse")
mcp_tool = McpToolSpec(client=mcp_client)

# get the agent
agent = await get_agent(mcp_tool)

# create the agent context
agent_context = Context(agent)
````

## Ячейка 15: code

````text
# Run the agent!
while True:
    user_input = input("Enter your message: ")
    if user_input == "exit":
        break
    print("User: ", user_input)
    response = await handle_user_message(user_input, agent, agent_context, verbose=True)
    print("Agent: ", response)
````

## Ячейка 16: code

````text

````