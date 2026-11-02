# Исходные ячейки: autogen-stock-analyst/coding_and_financial_analyst.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import os
import autogen
import json
from dotenv import load_dotenv
load_dotenv()


import datetime
import os

# custom_autogen_model package
from custom_autogen_model import CustomModelClient


# pyautogen package
from autogen import ConversableAgent, UserProxyAgent, AssistantAgent
from autogen.coding import LocalCommandLineCodeExecutor

````

## Ячейка 1: code

````text
def config_list(config, client_name="CustomModelClient"):
    dict_list = [config]

    # set the config into an environment variable
    os.environ["IMAGINE_AUTOGEN_CONFIG"] = json.dumps(dict_list)

    config_list_custom = autogen.config_list_from_json(
        "IMAGINE_AUTOGEN_CONFIG",
        filter_dict={"model_client_cls": [client_name]},
    )
    return config_list_custom
````

## Ячейка 2: markdown



## Ячейка 3: code

````text
api_key = os.environ["IMAGINE_API_KEY"]

config = {
    "model": "imaginechat",
    "model_client_cls": "CustomModelClient",
    "n": 1,
    "params": {"max_length": 1500, "api_key": api_key, "temperature": 0.0},
}

config_list_custom = config_list(config)
````

## Ячейка 4: code

````text
executor = LocalCommandLineCodeExecutor(
    timeout=60,
    work_dir="coding",
)
````

## Ячейка 5: code

````text
code_executor_agent = ConversableAgent(
    name="code_executor_agent",
    code_execution_config={"executor": executor},
    default_auto_reply="Please continue. If everything is done, reply 'TERMINATE'.",
)
````

## Ячейка 6: code

````text
code_writer_agent = UserProxyAgent(
    name="code_writer_agent",
    llm_config={"config_list": config_list_custom},
    code_execution_config=False,
)

# code_writer_agent = AssistantAgent(
#     name="code_writer_agent",
#     llm_config={"config_list": config_list_custom},
#     code_execution_config=False,
#     human_input_mode="NEVER",
# )
````

## Ячейка 7: code

````text
# register the custom client class to the agents
code_writer_agent.register_model_client(model_client_cls=CustomModelClient)
````

## Ячейка 8: code

````text
code_writer_agent_system_message = code_writer_agent.system_message
print(code_writer_agent_system_message)
````

## Ячейка 9: code

````text
# Ask the two agents to collaborate on a stock analysis task.
today = datetime.datetime.now().date()
message = (
    f"Today is {today}. "
    "Create a plot showing stock gain YTD over the whole year for (Qualcomm) QCOM and (Tesla) TSLA. "
    "Make sure the code is in python code block and save the figure"
    " to a file ytd_stock_gains.png."
    "use the yfinance lib"
    ""
)
````

## Ячейка 10: code

````text
chat_result = code_executor_agent.initiate_chat(
    code_writer_agent,
    message=message,
)
````

## Ячейка 11: code

````text

````