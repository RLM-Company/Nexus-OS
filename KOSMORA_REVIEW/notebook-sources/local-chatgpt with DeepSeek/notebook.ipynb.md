# Исходные ячейки: local-chatgpt with DeepSeek/notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: code

````text
import ollama

response = ollama.chat(model="deepseek-r1",
                   messages=[{"role": "user", "content": "Hello, how are you?"}])

print(response)
````

## Ячейка 1: code

````text
import ollama

response = ollama.chat(model="deepseek-r1",
                   messages=[{"role": "user", "content": "if 1+1=3, 4+5=10, what is 5+8=?"}])

print(response)
````

## Ячейка 2: code

````text

````