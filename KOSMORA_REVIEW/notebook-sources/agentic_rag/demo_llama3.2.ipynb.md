# Исходные ячейки: agentic_rag/demo_llama3.2.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# 100% local Agentic RAG

## Ячейка 1: code

````text
import warnings
from crewai import Agent, Crew, Task, LLM, Process
from src.agentic_rag.tools.custom_tool import DocumentSearchTool
from src.agentic_rag.tools.custom_tool import FireCrawlWebSearchTool

warnings.filterwarnings("ignore")
````

## Ячейка 2: markdown

### Setup LLM


## Ячейка 3: code

````text
llm = LLM(
    model="ollama/llama3.2",
    base_url="http://localhost:11434"
)
````

## Ячейка 4: markdown

### Setup Tools

## Ячейка 5: code

````text
pdf_tool = DocumentSearchTool(file_path='/Users/akshaypachaar/Eigen/ai-engineering/agentic_rag/knowledge/dspy.pdf')
````

## Ячейка 6: markdown

Make sure you have the API key for FireCrawl in your environment variables.

## Ячейка 7: code

````text
web_search_tool = FireCrawlWebSearchTool()
````

## Ячейка 8: markdown

### Agents

## Ячейка 9: code

````text
retriever_agent = Agent(
    role="""Retrieve relevant information to answer the user query: {query}""",
    goal="""Retrieve the most relevant information from the available sources 
            for the user query: {query}, always try to use the pdf search tool first. 
            If you are not able to retrieve the information from the pdf search tool 
            then try to use the web search tool.""",
    backstory="""You're a meticulous analyst with a keen eye for detail. 
                You're known for your ability understand the user query: {query} 
                and retrieve knowlege from the most suitable knowledge base.""",
    verbose=True,
    tools=[
        pdf_tool,
        web_search_tool
    ],
    # llm=llm
)

response_synthesizer_agent = Agent(
    role="""Response synthesizer agent for the user query: {query}""",
    goal="""Synthesize the retrieved information into a concise and coherent response 
            based on the user query: {query}. If you are not able to retrieve the 
            information then respond with "I'm sorry, I couldn't find the information 
            you're looking for.""",
    backstory="""You're a skilled communicator with a knack for turning complex 
                information into clear and concise responses.""",
    verbose=True,
    # llm=llm
)

````

## Ячейка 10: markdown

### Tasks

## Ячейка 11: code

````text
retrieval_task = Task(
    description="""Retrieve the most relevant information from the available 
                   sources for the user query: {query}""",
    expected_output="""The most relevant information in form of text as retrieved
                       from the sources.""",
    agent=retriever_agent
)

response_task = Task(
    description="""Synthesize the final response for the user query: {query}""",
    expected_output="""A concise and coherent response based on the retrieved infromation
                       from the right source for the user query: {query}. If you are not 
                       able to retrieve the information then respond with 
                       I'm sorry, I couldn't find the information you're looking for.""",
    agent=response_synthesizer_agent
)
````

## Ячейка 12: markdown

### Initialize Crew

## Ячейка 13: code

````text
crew = Crew(
			agents=[retriever_agent, response_synthesizer_agent], 
			tasks=[retrieval_task, response_task],
			process=Process.sequential,
			verbose=True,
			# process=Process.hierarchical, # In case you wanna use that instead https://docs.crewai.com/how-to/Hierarchical/
		)
````

## Ячейка 14: markdown

### Kickoff Crew

## Ячейка 15: code

````text
result = crew.kickoff(inputs={"query": "When is Australian open 2025 happening?"})
````

## Ячейка 16: code

````text
print(result)
````

## Ячейка 17: code

````text

````