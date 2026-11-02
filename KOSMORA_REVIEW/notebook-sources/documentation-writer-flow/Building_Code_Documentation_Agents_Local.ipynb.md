# Исходные ячейки: documentation-writer-flow/Building_Code_Documentation_Agents_Local.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Building Code Documentation Agents with CrewAI

## Ячейка 1: markdown

## Prerequisites 

## Ячейка 2: code

````text
from crewai import LLM

def load_llm():
    llm = LLM(
        # model="ollama/deepseek-r1:7b",
        model="ollama/llama3.2",
        base_url="http://localhost:11434"
    )
    return llm
````

## Ячейка 3: markdown

### Initialization and Setup
Initial imports for the CrewAI Flow and Crew and setting up the environment

## Ячейка 4: code

````text
# Importing necessary libraries
import yaml
import subprocess
from pathlib import Path
from pydantic import BaseModel

# Importing Crew related components
from crewai import Agent, Task, Crew

# Importing CrewAI Flow related components
from crewai.flow.flow import Flow, listen, start

# Apply a patch to allow nested asyncio loops in Jupyter
import nest_asyncio
nest_asyncio.apply()
````

## Ячейка 5: markdown

## Define the project URL

In this demo, a sample repository is provided for you. However, feel free to test this on other public repositories! 

## Ячейка 6: code

````text
project_url = "https://github.com/crewAIInc/nvidia-demo"
````

## Ячейка 7: markdown

## Plan for our Flow

1. Clone the repository for the project
2. Plan the documentation for the project **[Planning Crew]** 
3. Create the documentation for the project **[Documentation Crew]**

## Ячейка 8: markdown

## Create Pydantic Schema

Initial strucutre data we will use to capture the output of the planning crew

## Ячейка 9: code

````text
# Define data structures to capture documentation planning output
class DocItem(BaseModel):
    """Represents a documentation item"""
    title: str
    description: str
    prerequisites: str
    examples: list[str]
    goal: str

class DocPlan(BaseModel):
    """Documentation plan"""
    overview: str
    docs: list[DocItem]
````

## Ячейка 10: markdown

Optimizing for Llama 3.2 Prompting Template

When using different models the ability to go a lower level and change the prompting template can drastically improve the performance of the model, you want to make sure to watch for the model's training prompt patterns and adjust accordingly.

For Meta's Llama you can find it [in here](https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_1/#prompt-template)

## Ячейка 11: code

````text
# Agents Prompting Template for Llama 3.3
system_template="""<|begin_of_text|><|start_header_id|>system<|end_header_id|>{{ .System }}<|eot_id|>"""
prompt_template="""<|start_header_id|>user<|end_header_id|>{{ .Prompt }}<|eot_id|>"""
response_template="""<|start_header_id|>assistant<|end_header_id|>{{ .Response }}<|eot_id|>"""
````

## Ячейка 12: markdown

## Create Planning Crew

Crew of AI Agents to strategize and create a documentation plan.

## Ячейка 13: code

````text
from crewai_tools import (
    DirectoryReadTool,
    FileReadTool,
)

# Load agent and task configurations from YAML files
with open('config/planner_agents.yaml', 'r') as f:
    agents_config = yaml.safe_load(f)

with open('config/planner_tasks.yaml', 'r') as f:
    tasks_config = yaml.safe_load(f)

code_explorer = Agent(
  config=agents_config['code_explorer'],
  system_template=system_template,
  prompt_template=prompt_template,
  response_template=response_template,
  tools=[
    DirectoryReadTool(),
    FileReadTool()
  ],
  llm=load_llm()
)
documentation_planner = Agent(
  config=agents_config['documentation_planner'],
  system_template=system_template,
  prompt_template=prompt_template,
  response_template=response_template,
  tools=[
    DirectoryReadTool(),
    FileReadTool()
  ],
  llm=load_llm()
)

analyze_codebase = Task(
  config=tasks_config['analyze_codebase'],
  agent=code_explorer
)
create_documentation_plan = Task(
  config=tasks_config['create_documentation_plan'],
  agent=documentation_planner,
  output_pydantic=DocPlan
)

planning_crew = Crew(
    agents=[code_explorer, documentation_planner],
    tasks=[analyze_codebase, create_documentation_plan],
    verbose=False
)
````

## Ячейка 14: markdown

## Create Documentation Crew

Crew of AI Agents to execute the documentation plan and create the documentation.
Creating a guardrail to check the mermaid syntax in the documentation.

## Ячейка 15: code

````text
from crewai.tasks import TaskOutput
import re

def check_mermaid_syntax(task_output: TaskOutput):
    text = task_output.raw

    # Find all mermaid code blocks in the text
    mermaid_blocks = re.findall(r'```mermaid\n(.*?)\n```', text, re.DOTALL)

    for block in mermaid_blocks:
        diagram_text = block.strip()
        lines = diagram_text.split('\n')
        corrected_lines = []

        for line in lines:
            corrected_line = re.sub(r'\|.*?\|>', lambda match: match.group(0).replace('|>', '|'), line)
            corrected_lines.append(corrected_line)

        text = text.replace(block, "\n".join(corrected_lines))

    task_output.raw = text
    return (True, task_output)
````

## Ячейка 16: code

````text
from crewai_tools import (
    DirectoryReadTool,
    FileReadTool,
    WebsiteSearchTool
)

# Load agent and task configurations from YAML files
with open('config/documentation_agents.yaml', 'r') as f:
    agents_config = yaml.safe_load(f)

with open('config/documentation_tasks.yaml', 'r') as f:
    tasks_config = yaml.safe_load(f)

overview_writer = Agent(config=agents_config['overview_writer'], tools=[
    DirectoryReadTool(),
    FileReadTool(),
    WebsiteSearchTool(
      website="https://mermaid.js.org/intro/",
      config=dict(
        embedder=dict(
            provider="ollama",
            config=dict(
                model="nomic-embed-text",
            ),
        )
        )
      )
  ],
  llm=load_llm()
)

documentation_reviewer = Agent(config=agents_config['documentation_reviewer'], tools=[
    DirectoryReadTool(directory="docs/", name="Check existing documentation folder"),
    FileReadTool(),
  ],
  llm=load_llm()
)

draft_documentation = Task(
  config=tasks_config['draft_documentation'],
  agent=overview_writer
)

qa_review_documentation = Task(
  config=tasks_config['qa_review_documentation'],
  agent=documentation_reviewer,
  guardrail=check_mermaid_syntax,
  max_retries=5
)

documentation_crew = Crew(
    agents=[overview_writer, documentation_reviewer],
    tasks=[draft_documentation, qa_review_documentation],
    verbose=False
)
````

## Ячейка 17: markdown

## Create Documentation Flow

A Flow to create the documentation for the project where we will use the planning crew to plan the documentation and the documentation crew to create the documentation

## Ячейка 18: code

````text

from typing import List


class DocumentationState(BaseModel):
  """
  State for the documentation flow
  """
  project_url: str = project_url
  repo_path: Path = "workdir/"
  docs: List[str] = []

class CreateDocumentationFlow(Flow[DocumentationState]):
  # Clone the repository, initial step
  # No need for AI Agents on this step, so we just use regular Python code
  @start()
  def clone_repo(self):
    print(f"# Cloning repository: {self.state.project_url}\n")
    # Extract repo name from URL
    repo_name = self.state.project_url.split("/")[-1]
    self.state.repo_path = f"{self.state.repo_path}{repo_name}"

  # Check if directory exists
    if Path(self.state.repo_path).exists():
      print(f"# Repository directory already exists at {self.state.repo_path}\n")
      subprocess.run(["rm", "-rf", self.state.repo_path])
      print("# Removed existing directory\n")

    # Clone the repository
    subprocess.run(["git", "clone", self.state.project_url, self.state.repo_path])
    return self.state

  @listen(clone_repo)
  def plan_docs(self):
    print(f"# Planning documentation for: {self.state.repo_path}\n")
    result = planning_crew.kickoff(inputs={'repo_path': self.state.repo_path})
    print(f"# Planned docs for {self.state.repo_path}:")
    for doc in result.pydantic.docs:
        print(f"    - {doc.title}")
    return result

  @listen(plan_docs)
  def save_plan(self, plan):
    with open("docs/plan.json", "w") as f:
      f.write(plan.raw)

  @listen(plan_docs)
  def create_docs(self, plan):
    for doc in plan.pydantic.docs:
      print(f"\n# Creating documentation for: {doc.title}")
      result = documentation_crew.kickoff(inputs={
        'repo_path': self.state.repo_path,
        'title': doc.title,
        'overview': plan.pydantic.overview,
        'description': doc.description,
        'prerequisites': doc.prerequisites,
        'examples': '\n'.join(doc.examples),
        'goal': doc.goal
      })

      # Save documentation to file in docs folder
      docs_dir = Path("docs")
      docs_dir.mkdir(exist_ok=True)
      title = doc.title.lower().replace(" ", "_") + ".mdx"
      self.state.docs.append(str(docs_dir / title))
      with open(docs_dir / title, "w") as f:
          f.write(result.raw)
    print(f"\n# Documentation created for: {self.state.repo_path}")
````

## Ячейка 19: markdown

## Run Documentation Flow

After running this cell, check the `docs` directory for the generated documentation. 

## Ячейка 20: code

````text
flow = CreateDocumentationFlow()
flow.kickoff()
````

## Ячейка 21: markdown

## Plot One of the Documents

Let's visualize one of the generated documentation files to verify the output. This will help us ensure the documentation was created successfully and formatted correctly.

The generated documentation files can be found in the `docs` directory in the root of the project. Each documentation file is saved with a `.mdx` extension and follows the naming convention of lowercase words separated by underscores.

## Ячейка 22: code

````text
# List all files in docs folder and display the first doc using IPython.display
from IPython.display import Markdown
import pathlib

docs_dir = pathlib.Path("docs")
print("Documentation files generated:")
for doc_file in docs_dir.glob("*.mdx"):
    print(f"- docs/{doc_file.name}")

print("\nDisplaying contents of first doc:\n")
first_doc = pathlib.Path(flow.state.docs[0]).read_text()
display(Markdown(first_doc))
````