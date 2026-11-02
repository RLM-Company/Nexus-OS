# Исходные ячейки: DeepSeek-finetuning/Fine_tune_DeepSeek.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
# Implementation of DeepSeek Finetuning using Unsloth and Ollama
# Inspired from https://unsloth.ai/blog/deepseek-r1
````

## Ячейка 1: code

````text
!pip install unsloth

!pip uninstall unsloth -y && pip install --upgrade --no-cache-dir --no-deps git+https://github.com/unslothai/unsloth.git
````

## Ячейка 2: code

````text
from unsloth import FastLanguageModel
import torch

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/DeepSeek-R1-Distill-Llama-8B-unsloth-bnb-4bit",
    max_seq_length = 2048,
    dtype = None,
    load_in_4bit = True,
)
````

## Ячейка 3: code

````text
model = FastLanguageModel.get_peft_model(
    model,
    r = 4,
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
    bias = "none",
    use_gradient_checkpointing = "unsloth",
    random_state = 42,
    use_rslora = False,
    loftq_config = None,
)
````

## Ячейка 4: markdown

<a name="Data"></a>
### Data Prep

## Ячейка 5: code

````text
from datasets import load_dataset
dataset = load_dataset("vicgalle/alpaca-gpt4", split = "train")
print(dataset.column_names)
````

## Ячейка 6: code

````text
dataset[0]
````

## Ячейка 7: code

````text
from unsloth import to_sharegpt

dataset = to_sharegpt(
    dataset,
    merged_prompt = "{instruction}[[\nYour input is:\n{input}]]",
    output_column_name = "output",
    conversation_extension = 3, # Select more to handle longer conversations
)
````

## Ячейка 8: code

````text
from unsloth import standardize_sharegpt
dataset = standardize_sharegpt(dataset)
````

## Ячейка 9: code

````text
dataset[0]['conversations']
````

## Ячейка 10: markdown

### Customizable Chat Templates

## Ячейка 11: code

````text
chat_template = """Below are some instructions that describe some tasks. Write responses that appropriately complete each request.

### Instruction:
{INPUT}

### Response:
{OUTPUT}"""

from unsloth import apply_chat_template
dataset = apply_chat_template(
    dataset,
    tokenizer = tokenizer,
    chat_template = chat_template,
    # default_system_message = "You are a helpful assistant", << [OPTIONAL]
)
````

## Ячейка 12: markdown

<a name="Train"></a>
### Train the model

## Ячейка 13: code

````text
from trl import SFTTrainer
from transformers import TrainingArguments
from unsloth import is_bfloat16_supported

trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    packing = False,
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 5,
        max_steps = 60,
        learning_rate = 2e-4,
        fp16 = not is_bfloat16_supported(),
        bf16 = is_bfloat16_supported(),
        logging_steps = 1,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "outputs",
        report_to = "none", # Use this for WandB etc
    ),
)
````

## Ячейка 14: code

````text
trainer_stats = trainer.train()
````

## Ячейка 15: markdown

<a name="Ollama"></a>
### Ollama

## Ячейка 16: code

````text
!curl -fsSL https://ollama.com/install.sh | sh
````

## Ячейка 17: code

````text
model.save_pretrained_gguf("model", tokenizer)
````

## Ячейка 18: code

````text
import subprocess
subprocess.Popen(["ollama", "serve"])
import time
time.sleep(3)
````

## Ячейка 19: code

````text
print(tokenizer._ollama_modelfile)
````

## Ячейка 20: markdown

We now will create an `Ollama` model called `unsloth_model` using the `Modelfile` which we auto generated!

## Ячейка 21: code

````text
!ollama create deepseek_finetuned_model -f ./model/Modelfile
````

## Ячейка 22: code

````text
!pip install ollama
````

## Ячейка 23: code

````text
import ollama

response = ollama.chat(model="deepseek_finetuned_model",
            messages=[{ "role": "user", "content": "Continue the Fibonacci sequence: 1, 1, 2, 3, 5, 8,"
            },
                      ])

print(response.message.content)
````

## Ячейка 24: code

````text
from IPython.display import Markdown
import ollama

response = ollama.chat(model="deepseek_finetuned_model",
                       messages=[{"role": "user",
                                  "content": "How to add chart to a document?"},
                      ])

Markdown(response.message.content)
````