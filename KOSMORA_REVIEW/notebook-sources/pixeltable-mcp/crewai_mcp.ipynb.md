# Исходные ячейки: pixeltable-mcp/crewai_mcp.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Pixeltable MCP with CrewAI Flow

This notebook demonstrates a sophisticated multimodal AI system that uses CrewAI Flows to intelligently route and process different types of media queries. The system includes specialized agents for handling images, videos, audio, and documents using Pixeltable's indexing and search capabilities.

## Overview

The **PixeltableManagerFlow** leverages:
- **CrewAI Flows**: For orchestrating multi-agent workflows
- **Pixeltable Tools**: For multimodal data indexing and retrieval
- **Specialized Agents**: Each expert in their respective domain (image, video, audio, document)
- **Intelligent Routing**: Automatic query classification and delegation

## Ячейка 1: markdown

## 📦 Required Imports

Import all necessary libraries for the implementation:

## Ячейка 2: code

````text
import os
from typing import Dict, Any
from IPython.display import display, Markdown, HTML
from pydantic import BaseModel
from crewai import Agent, Task, Crew
from crewai_tools import MCPServerAdapter
from crewai import LLM
from crewai.flow.flow import Flow, router, start, listen, or_
````

## Ячейка 3: markdown

## 🤖 LLM Configuration

Configure the Language Models for different purposes:
- **Router LLM**: Used by the routing agent for query classification
- **Agent LLM**: Used by specialist agents for executing tasks
- **Response LLM**: Used for generating final responses to user queries

## Ячейка 4: code

````text
from dotenv import load_dotenv
load_dotenv()
````

## Ячейка 5: markdown

Note: We're using OpenAI LLMs in some agents for better outputs, the focus here is to demonstrate the unified data storage MCP server by Pixeltable and connecting them to your own Agents built using CrewAI.

## Ячейка 6: code

````text
# Define our LLMs for providing to agents
router_llm = LLM(model="ollama/gemma3")
agent_llm = LLM(model="openai/o3-mini")
response_llm = LLM(model="openai/gpt-4")
````

## Ячейка 7: markdown

## 🌐 Pixeltable Server Configuration

Configure the MCP (Model Context Protocol) servers for different Pixeltable services:
- **Image Server** (Port 8080): Handles image indexing and search
- **Video Server** (Port 8081): Handles video transcription and search  
- **Audio Server** (Port 8082): Handles audio transcription and search
- **Document Server** (Port 8083): Handles document indexing and search

## Ячейка 8: code

````text
server_configurations = [
    # Pixeltable SSE Servers
    {
        "url": "http://localhost:8080/sse",
        "transport": "sse"
    },
    {
        "url": "http://localhost:8081/sse",
        "transport": "sse"
    },
    {
        "url": "http://localhost:8082/sse",
        "transport": "sse"
    },
    {
        "url": "http://localhost:8083/sse",
        "transport": "sse"
    },
]
````

## Ячейка 9: code

````text
with MCPServerAdapter(server_configurations) as mcp_tools:
    print(f"Available tools: {[tool.name for tool in mcp_tools]}")
````

## Ячейка 10: markdown

## 🔄 PixeltableManagerFlow Class

The main flow class that orchestrates the entire multimodal AI system. This implementation includes:

### Key Components:
1. **State Management**: Using Pydantic models for type-safe state handling
2. **Intelligent Routing**: Automatic query classification to determine the appropriate specialist
3. **Specialist Agents**: Dedicated agents for each media type
4. **Result Synthesis**: Final processing to create user-friendly responses

### Flow Architecture:
```
User Query → Router Agent → Specialist Agent → Synthesis Agent → Final Result
```

### Supported Operations:
- **Image**: Index creation, image insertion, semantic search
- **Video**: Index creation, video insertion, transcription-based search
- **Audio**: Index creation, audio insertion, speech-to-text search
- **Document**: Index creation, document insertion, text-based search

## Ячейка 11: code

````text
class PixeltableFlowState(BaseModel):
    query: str = ""
    result: str = ""


class Specialist(BaseModel):
    name: str


class PixeltableManagerFlow(Flow[PixeltableFlowState]):
    """
    A CrewAI Flow to intelligently delegate multimodal indexing/search queries
    to specialized agents using Pixeltable tools.
    """

    @start()
    def start_flow(self) -> Dict[str, Any]:
        print(f"Flow started with query: {self.state.query}")
        return {"query": self.state.query}

    @router(start_flow)
    def route_query(self) -> str:
        """Uses an agent to determine the correct specialist for the user's query."""
        print("--- Using Router Agent to classify query ---")
        router_agent = Agent(
            role="Task Router",
            goal=(
                "Analyze the user's query and determine the correct specialist. "
                "The available specialists are: 'image_specialist', 'video_specialist', "
                "'audio_specialist', 'document_specialist'."
            ),
            backstory="An AI expert in routing tasks to the appropriate specialist agent.",
            llm=router_llm,
        )

        routing_task = Task(
            description=f"Analyze the following user query and determine which specialist should handle it: '{self.state.query}'.",
            expected_output="""
Your output MUST be a single string from the following options:
- 'image_specialist'
- 'video_specialist'
- 'audio_specialist'
- 'document_specialist'
- 'default_specialist'
""",
            agent=router_agent,
            output_json=Specialist,
        )

        # Execute the routing task
        crew = Crew(agents=[router_agent], tasks=[routing_task], verbose=True)
        route = crew.kickoff()
        specialist = route["name"]
        return specialist

    @listen("image_specialist")
    def handle_image_task(self) -> Dict[str, Any]:
        print("--- Delegating to Image Specialist ---")
        try:
            with MCPServerAdapter(server_configurations) as mcp_tools:
                agent = Agent(
                    role="Image Specialist",
                    goal=(
                        "Understand user queries and manage image indexing tasks using Pixeltable. "
                        "First, check if the specified image index exists by listing current indexes. "
                        "If it does not exist, create it. Once the index is confirmed or created, "
                        "either insert images into the index or perform search operations on it, "
                        "depending on the user's intent."
                    ),
                    backstory=(
                        "You are trained in visual data management. With expertise in semantic image embedding, "
                        "vector search retrieval, and index optimization, you transform image data into searchable visual knowledge bases."
                    ),
                    tools=[
                        mcp_tools["setup_image_index"],
                        mcp_tools["insert_image"],
                        mcp_tools["query_image"],
                        mcp_tools["list_image_tables"],
                    ],
                    llm=agent_llm,
                )

                task = Task(
                    description=f"""
Interpret the following user query and take the appropriate image-related actions using Pixeltable's tools: '{self.state.query}'.

You may:
- Create image index with table name
- Insert image file to specified image index
- Query specified image index by text question
- List existing image indexes

Choose the best actions to meet the user's request.
""",
                    expected_output="""
Output should include:
- Reasoning of performed operation
- Summary of successful tool use
- Recommended next actions

Format output as markdown.
""",
                    agent=agent,
                    markdown=True,
                )

                crew = Crew(agents=[agent], tasks=[task], verbose=True)
                result = crew.kickoff()
                return {"result": str(result)}

        except Exception as e:
            return {"result": f"Error processing image task: {e}"}

    @listen("video_specialist")
    def handle_video_task(self) -> Dict[str, Any]:
        print("--- Delegating to Video Specialist ---")
        try:
            with MCPServerAdapter(server_configurations) as mcp_tools:
                agent = Agent(
                    role="Video Specialist",
                    goal=(
                        "Understand user queries and manage video indexing tasks using Pixeltable. "
                        "First, check if the specified video index exists by listing current indexes. "
                        "If it does not exist, create it. Once the index is confirmed or created, "
                        "either insert videos into the index or perform search operations on it, "
                        "depending on the user's intent."
                    ),
                    backstory=(
                        "You specialize in understanding visual and spoken information in videos. "
                        "Using transcription, indexing, and retrieval techniques, you make video data searchable and useful."
                    ),
                    tools=[
                        mcp_tools["setup_video_index"],
                        mcp_tools["insert_video"],
                        mcp_tools["query_video"],
                        mcp_tools["list_video_tables"],
                    ],
                    llm=agent_llm,
                )

                task = Task(
                    description=f"""
Interpret the following user query and take the appropriate video-related actions using Pixeltable's tools: '{self.state.query}'.

You may:
- Create video index with table name
- Insert video file to specified video index
- Query specified video index by text question
- List existing video indexes

Choose the best actions to meet the user's request.
""",
                    expected_output="""
Output should include:
- Reasoning of performed operation
- Summary of successful tool use
- Recommended next actions

Format output as markdown.
""",
                    agent=agent,
                    markdown=True,
                )

                crew = Crew(agents=[agent], tasks=[task], verbose=True)
                result = crew.kickoff()
                return {"result": str(result)}

        except Exception as e:
            return {"result": f"Error processing video task: {e}"}

    @listen("audio_specialist")
    def handle_audio_task(self) -> Dict[str, Any]:
        print("--- Delegating to Audio Specialist ---")
        try:
            with MCPServerAdapter(server_configurations) as mcp_tools:
                agent = Agent(
                    role="Audio Specialist",
                    goal=(
                        "Understand user queries and manage audio indexing tasks using Pixeltable. "
                        "First, check if the specified audio index exists by listing current indexes. "
                        "If it does not exist, create it. Once the index is confirmed or created, "
                        "either insert audios into the index or perform search operations on it, "
                        "depending on the user's intent."
                    ),
                    backstory=(
                        "With advanced Whisper transcription models and semantic search tools, you specialize in turning "
                        "spoken content into searchable knowledge graphs."
                    ),
                    tools=[
                        mcp_tools["setup_audio_index"],
                        mcp_tools["insert_audio"],
                        mcp_tools["query_audio"],
                        mcp_tools["list_audio_tables"],
                    ],
                    llm=agent_llm,
                )

                task = Task(
                    description=f"""
Interpret the following user query and take the appropriate audio-related actions using Pixeltable's tools: '{self.state.query}'.

You may:
- Create audio indexe with table name
- Insert audio file to specified audio index
- Query specified audio index by text question
- List existing audio indexes

Choose the best actions to meet the user's request.
""",
                    expected_output="""
Output should include:
- Reasoning of performed operation
- Summary of successful tool use
- Recommended next actions

Format output as markdown.
""",
                    agent=agent,
                    markdown=True,
                )

                crew = Crew(agents=[agent], tasks=[task], verbose=True)
                result = crew.kickoff()
                return {"result": str(result)}

        except Exception as e:
            return {"result": f"Error processing audio task: {e}"}

    @listen("document_specialist")
    def handle_document_task(self) -> Dict[str, Any]:
        print("--- Delegating to Document Specialist ---")
        try:
            with MCPServerAdapter(server_configurations) as mcp_tools:
                agent = Agent(
                    role="Document Specialist",
                    goal=(
                        "Understand user queries and manage document indexing tasks using Pixeltable. "
                        "First, check if the specified document index exists by listing current indexes. "
                        "If it does not exist, create it. Once the index is confirmed or created, "
                        "either insert documents into the index or perform search operations on it, "
                        "depending on the user's intent."
                    ),
                    backstory=(
                        "You are an expert in document parsing and information retrieval. From PDFs to large text document corpus, "
                        "you chunk, index, and semantically search textual data with precision."
                    ),
                    tools=[
                        mcp_tools["setup_document_index"],
                        mcp_tools["insert_document"],
                        mcp_tools["query_document"],
                        mcp_tools["list_document_tables"],
                    ],
                    llm=agent_llm,
                )

                task = Task(
                    description=f"""
Interpret the following user query and take the appropriate document-related actions using Pixeltable's tools: '{self.state.query}'.

You may:
- Create document index with table name
- Insert document file to specified document index
- Query specified document index by text question
- List existing document indexes

Choose the best actions to meet the user's request.
""",
                    expected_output="""
Output should include:
- Reasoning of performed operation
- Summary of successful tool use
- Recommended next actions

Format output as markdown.
""",
                    agent=agent,
                    markdown=True,
                )

                crew = Crew(agents=[agent], tasks=[task], verbose=True)
                result = crew.kickoff()
                return {"result": str(result)}

        except Exception as e:
            return {"result": f"Error processing document task: {e}"}

    @listen("default_specialist")
    def handle_default_task(self) -> Dict[str, Any]:
        print("--- No specific specialist found, providing a general response. ---")
        return {
            "result": (
                "I'm not sure which type of content you're referring to.\n\n"
                "Please try rephrasing your query to mention one of the following types:\n"
                "- image\n- video\n- audio\n- document (PDF, text)"
            )
        }

    @listen(
        or_(
            "handle_image_task",
            "handle_video_task",
            "handle_audio_task",
            "handle_document_task",
            "handle_default_task",
        )
    )
    def synthesize_result(self, specialist_output: str):
        """Uses a synthesis agent to create a user-friendly final response."""
        print("--- Synthesizing Final Response ---")
        synthesis_agent = Agent(
            role="Synthesis Specialist",
            goal="Craft a clear, concise, and user-friendly response based on the technical output from the specialist agent.",
            backstory="An expert in communication and summarization.",
            llm=response_llm,
        )
        synthesis_task = Task(
            description=f"Based on the following result: {specialist_output} and the user query: {self.state.query} provide a precise and coherent response to the user",
            expected_output="A polished, final response suitable for the end-user.",
            agent=synthesis_agent,
        )

        crew = Crew(agents=[synthesis_agent], tasks=[synthesis_task], verbose=True)
        final_result = crew.kickoff()
        return {"result": str(final_result)}
````

## Ячейка 12: markdown

## 🚀 Usage Example

Demonstrate how to use the PixeltableManagerFlow with different types of queries:

### Example Queries:
1. **Video Index Creation and Insertion**: `"Insert this video with URL as, 'https://github.com/user-attachments/assets/edf6c7f1-8888-4a01-ab7a-f608302fcd03' to video index 'baby_videos'."`
2. **Video Search**: `"What's the name of the younger kid shown in this video stored in video index 'baby_videos'?"`

The flow will automatically:
- Classify the query type
- Route to the appropriate specialist
- Execute the required Pixeltable operations
- Synthesize a user-friendly response

## Ячейка 13: markdown

Let's first preview our video before execution

## Ячейка 14: code

````text
video_url = "https://github.com/user-attachments/assets/edf6c7f1-8888-4a01-ab7a-f608302fcd03"

HTML(f"""
<video width="640" height="480" controls>
  <source src="{video_url}" type="video/mp4">
  Your browser does not support the video tag.
</video>
""")
````

## Ячейка 15: code

````text
flow = PixeltableManagerFlow()
````

## Ячейка 16: code

````text
result = await flow.kickoff_async(inputs={'query': "Insert this video with URL as, 'https://github.com/user-attachments/assets/edf6c7f1-8888-4a01-ab7a-f608302fcd03' to video index 'baby_videos'."})

print(f"\n{'='*50}")
print(f"FINAL RESULT")
print(f"{'='*50}")
display(Markdown(result['result']))
````

## Ячейка 17: code

````text
result = await flow.kickoff_async(inputs={'query': "What's the name of the younger kid shown in this video stored in video index 'baby_videos'?"})

print(f"\n{'='*50}")
print(f"FINAL RESULT")
print(f"{'='*50}")
display(Markdown(result['result']))
````

## Ячейка 18: markdown

## 📊 Results and Analysis

The output below shows the complete execution trace of the multimodal AI system, including:

- **Router Decision**: How the query was classified
- **Specialist Execution**: The specific actions taken by the chosen agent
- **Tool Interactions**: Direct communication with Pixeltable services
- **Final Synthesis**: The polished user response

### Next Steps:
- Try different query types to see how routing works
- Experiment with different media types (images, audio, documents)
- Monitor the execution flow to understand agent interactions