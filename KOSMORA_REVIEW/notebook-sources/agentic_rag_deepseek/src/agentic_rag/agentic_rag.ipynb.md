# Исходные ячейки: agentic_rag_deepseek/src/agentic_rag/agentic_rag.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
# !pip install "chonkie[semantic]"
# !pip install markitdown
# !pip install qdrant-client
# !pip install fastembed
````

## Ячейка 1: code

````text
from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, crew, task
from crewai_tools import SerperDevTool
from crewai_tools import PDFSearchTool
# from tools.custom_tool import DocumentSearchTool
from tools.custom_tool import DocumentSearchTool

````

## Ячейка 2: code

````text
pdf_tool = DocumentSearchTool(file_path='/Users/akshaypachaar/Eigen/ai-engineering/agentic_rag/knowledge/dspy.pdf')
````

## Ячейка 3: code

````text
web_search_tool = SerperDevTool()
````

## Ячейка 4: code

````text
import yaml
with open('config/agents.yaml', 'r') as f:
    agents_config = yaml.safe_load(f)

with open('config/tasks.yaml', 'r') as f:
    tasks_config = yaml.safe_load(f)
````

## Ячейка 5: code

````text
retriever_agent = Agent(
    config=agents_config['retriever_agent'],
    verbose=True,
    tools=[
        pdf_tool,
        web_search_tool
    ]
)

response_synthesizer_agent = Agent(
    config=agents_config['response_synthesizer_agent'],
    verbose=True
)

retrieval_task = Task(
    description=tasks_config['retrieval_task']['description'],
    expected_output=tasks_config['retrieval_task']['expected_output'],  
    agent=retriever_agent
)

response_task = Task(
    description=tasks_config['response_task']['description'],
    expected_output=tasks_config['response_task']['expected_output'], 
    agent=response_synthesizer_agent
)
````

## Ячейка 6: code

````text
crew = Crew(
			agents=[retriever_agent, response_synthesizer_agent], 
			tasks=[retrieval_task, response_task],
			process=Process.sequential,
			verbose=True,
			# process=Process.hierarchical, # In case you wanna use that instead https://docs.crewai.com/how-to/Hierarchical/
		)
````

## Ячейка 7: code

````text
result = crew.kickoff(inputs={"query": "Who is elon musk?"})
print(result)
````