# Исходные ячейки: agent-with-mcp-memory/demo.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

## Build your first Agent with memory ft. MCP

## Ячейка 1: markdown

<img src="assets/agent-crashcourse2.gif" width="400" height="300">

## Ячейка 2: code

````text
from crewai import Crew, Process, Task, Agent
from dotenv import load_dotenv

load_dotenv()
````

## Ячейка 3: markdown

### Setup a local LLM

## Ячейка 4: code

````text
from crewai import LLM

llm = LLM(
    model="ollama/llama3.2",
    base_url="http://localhost:11434"
)
````

## Ячейка 5: markdown

### Simple QA crew

## Ячейка 6: code

````text
virtual_assistant = Agent(
    role="Virtual Assistant",
    goal="Help the user with their questions",
    backstory="You are an agent that can help the user with their questions.",
    allow_delegation=False,
    llm=llm
)

assistant_task = Task(
    description="Provide an answer to the user's {query}.",
    agent=virtual_assistant,
    expected_output="A concise answer to the user's query.",
)

crew = Crew(
    agents=[virtual_assistant],
    tasks=[assistant_task],
    verbose=True,
)

result = crew.kickoff(inputs={"query": "What is the capital of Spain?"})
print(result)
````

## Ячейка 7: markdown

#### Tracing and observability

## Ячейка 8: code

````text
import opik

opik.configure(use_local=False)

from opik.integrations.crewai import track_crewai

track_crewai(project_name="crewai-integration-demo")
````

## Ячейка 9: markdown

### Web Search tool

## Ячейка 10: code

````text
import os
print(os.getenv("LINKUP_API_KEY"))

````

## Ячейка 11: code

````text
from pydantic import BaseModel, Field
from linkup import LinkupClient
from typing import Type
from crewai.tools import BaseTool
import os

class LinkUpSearchInput(BaseModel):
    """Input schema for LinkUp Search Tool."""
    query: str = Field(description="The search query to perform")
    depth: str = Field(default="standard",
                       description="Depth of search: 'standard' or 'deep'")
    output_type: str = Field(
        default="searchResults", description="Output type: 'searchResults', 'sourcedAnswer', or 'structured'")


class LinkUpSearchTool(BaseTool):
    name: str = "LinkUp Search"
    description: str = "Search the web for information using LinkUp and return comprehensive results"
    args_schema: Type[BaseModel] = LinkUpSearchInput

    def __init__(self):
        super().__init__()

    def _run(self, query: str, depth: str = "standard", output_type: str = "searchResults") -> str:
        """Execute LinkUp search and return results."""
        try:
            # Initialize LinkUp client with API key from environment variables
            linkup_client = LinkupClient(api_key=os.getenv("LINKUP_API_KEY"))

            # Perform search
            search_response = linkup_client.search(
                query=query,
                depth=depth,
                output_type=output_type
            )

            return str(search_response)
        except Exception as e:
            return f"Error occurred while searching: {str(e)}"
````

## Ячейка 12: markdown

### Crew with tools

## Ячейка 13: code

````text
web_search_agent = Agent(
    role="Web Search Agent",
    goal="Search the web for information",
    backstory="You are an agent that can search the web for information.",
    allow_delegation=False,
    tools=[LinkUpSearchTool()],
)

web_search_task = Task(
    description="Search the web for information about {query}.",
    agent=web_search_agent,
    expected_output="A concise answer to the user's query based on the search results.",
)

crew = Crew(
    agents=[web_search_agent],
    tasks=[web_search_task],
    verbose=True,
)

result = crew.kickoff(inputs={"query": "Give me a summary of what is happening in Wimbeldon 2025?"})
print(result)
````

## Ячейка 14: markdown

### CrewAI meets MCP

Using MCP servers as tools with Crew Agents

## Ячейка 15: code

````text
from crewai import Agent
from crewai_tools import MCPServerAdapter


# 2. SSE Server:
server_params = {
    "url": "http://localhost:8080/sse",
    "transport": "sse"
}

with MCPServerAdapter(server_params) as mcp_tools:
    print(f"Available tools: {[tool.name for tool in mcp_tools]}")
````

## Ячейка 16: code

````text
# Example usage (uncomment and adapt once server_params is set):
with MCPServerAdapter(server_params) as mcp_tools:
    print(f"Available tools: {[tool.name for tool in mcp_tools]}")

    web_search_agent = Agent(
        role="Web Search Agent",
        goal="Search the web for information",
        backstory="You are an agent that can search the web for information.",
        allow_delegation=False,
        tools=[mcp_tools["web_search"]],
    )

    web_search_task = Task(
        description="Search the web for information about {query}.",
        agent=web_search_agent,
        expected_output="A concise answer to the user's query based on the search results.",
    )

    crew = Crew(
        agents=[web_search_agent],
        tasks=[web_search_task],
        verbose=True,
    )

    result = crew.kickoff(inputs={"query": "Give me a summary of what is happening in Wimbledon 2025?"})
    print(result)
````

## Ячейка 17: markdown

### Knowledge graph based human like memory for Agents

## Ячейка 18: markdown

<img src="assets/zep-memory.gif" width="400" height="400">

## Ячейка 19: markdown

### Agents with knowledge graph memory


## Ячейка 20: markdown

<img src="assets/agent-crashcourse1.gif" width="400" height="400">

## Ячейка 21: code

````text
from crewai import Agent, Task, Crew

from crewai_tools import MCPServerAdapter

# MCP configuration for websearch and memory MCP servers
server_params = [
    {
        "url": "http://localhost:8000/sse",
        "transport": "sse"
    },
    {
    "url": "http://localhost:8080/sse",
    "transport": "sse"
    }
  ]

# Create agents under the MCP context manager
with MCPServerAdapter(server_params) as mcp_tools:
    # Assistant Agent
    assistant_agent = Agent(
        role="Helpful Assistant",
        goal="Provide accurate and helpful responses to user queries",
        backstory="I am a helpful AI assistant that can search the web when needed to provide accurate information.",
        allow_delegation=False,
        tools=[mcp_tools["web_search"]]
    )

    # Memory Manager Agent  
    memory_manager = Agent(
        role="Memory Manager",
        goal="Store and manage conversation history",
        backstory="I am responsible for maintaining the conversation memory by storing relevant information.",
        allow_delegation=False,
        tools=[mcp_tools["add_memory"]]
    )

    # Response Generator Agent
    response_generator = Agent(
        role="Response Generator",
        goal="Generate coherent responses using memory context",
        backstory="I analyze memory nodes to generate contextually relevant responses.",
        allow_delegation=False,
        tools=[mcp_tools["search_memory_nodes"]]
    )

    # Define tasks
    assistant_task = Task(
        description="Process the user query '{query}' and provide a helpful response. Search the web if needed.",
        agent=assistant_agent,
        expected_output="A detailed response addressing the user's query"
    )

    memory_task = Task(
        description="Store the query '{query}' and response in memory for future reference",
        agent=memory_manager,
        expected_output="Confirmation of memory storage"
    )

    response_gen_task = Task(
        description="Generate a response for '{query}' using relevant information from memory",
        agent=response_generator,
        expected_output="A coherent response incorporating context from memory"
    )

    # Create crew with all agents and tasks
    crew = Crew(
        agents=[assistant_agent, memory_manager, response_generator],
        tasks=[assistant_task, memory_task, response_gen_task],
        verbose=True
    )

    # Example usage
    result = crew.kickoff(
        inputs={
            "query": "What is happening in FIFA club world cup 2025?",
        }
    )
    print(result)

````

## Ячейка 22: code

````text
from crewai import Agent
from crewai_tools import MCPServerAdapter


server_params = [
    {
        "url": "http://localhost:8000/sse",
        "transport": "sse"
    },
    {
    "url": "http://localhost:8080/sse",
    "transport": "sse"
    }
  ]


# Example usage (uncomment and adapt once server_params is set):
with MCPServerAdapter(server_params) as mcp_tools:
    print(f"Available tools: {[tool.name for tool in mcp_tools]}")
````

## Ячейка 23: code

````text
from crewai import Agent
from crewai_tools import MCPServerAdapter


# 2. SSE Server:
server_params = {
    "url": "http://localhost:8000/sse",
    "transport": "sse"
}

with MCPServerAdapter(server_params) as mcp_tools:
    print(f"Available tools: {[tool.name for tool in mcp_tools]}")
````

## Ячейка 24: code

````text
from crewai import Agent, Task, Crew

from crewai_tools import MCPServerAdapter

# MCP configuration for websearch and memory MCP servers
server_params = [
    {
        "url": "http://localhost:8000/sse",
        "transport": "sse"
    }
  ]

# Create agents under the MCP context manager
with MCPServerAdapter(server_params) as mcp_tools:
    print(f"Available tools: {[tool.name for tool in mcp_tools]}")
    # Assistant Agent
    memory_manager = Agent(
        role="Clears memory",
        goal="Clear the memory",
        backstory="I am a helpful AI assistant that can clear the memory.",
        allow_delegation=False,
        tools=[mcp_tools["clear_graph"]]
    )


    memory_task = Task(
        description="Clear the memory",
        agent=memory_manager,
        expected_output="Confirmation of memory cleared"
    )

    # Create crew with all agents and tasks
    crew = Crew(
        agents=[memory_manager],
        tasks=[ memory_task],
        verbose=True
    )

    # Example usage
    result = crew.kickoff(
        inputs={
            
        }
    )
    print(result)

````

## Ячейка 25: code

````text
from crewai import Agent, Task, Crew

from crewai_tools import MCPServerAdapter

# MCP configuration for websearch and memory MCP servers
server_params = [
    {
        "url": "http://localhost:8000/sse",
        "transport": "sse"
    }
  ]

# Create agents under the MCP context manager
with MCPServerAdapter(server_params) as mcp_tools:
    print(f"Available tools: {[tool.name for tool in mcp_tools]}")
````

## Ячейка 26: code

````text

````

## Ячейка 27: code

````text

````