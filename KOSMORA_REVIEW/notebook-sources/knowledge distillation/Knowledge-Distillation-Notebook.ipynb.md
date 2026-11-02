# Исходные ячейки: knowledge distillation/Knowledge-Distillation-Notebook.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Knowledge distillation implementation

Read about 5 more techniques for model compression here: [Machine Learning Model Compression: A Critical Step Towards Efficient Deep Learning](https://www.dailydoseofds.com/model-compression-a-critical-step-towards-efficient-machine-learning)


## Ячейка 1: markdown

# Imports

## Ячейка 2: code

````text
import sys
import torch
import torch.nn as nn
import torch.optim as optim
import torchvision
import torchvision.transforms as transforms
import torch.nn.functional as F
import numpy as np
import pandas as pd

from time import time
from tqdm import tqdm
from torch.utils.data import DataLoader
````

## Ячейка 3: markdown

# Load the MNIST dataset

## Ячейка 4: code

````text
transform = transforms.Compose([transforms.ToTensor(), transforms.Normalize((0.5,), (0.5,))])
trainset = torchvision.datasets.MNIST(root='./data', train=True, download=True, transform=transform)
trainloader = DataLoader(trainset, batch_size=64, shuffle=True)

testset = torchvision.datasets.MNIST(root='./data', train=False, download=True, transform=transform)
testloader = DataLoader(testset, batch_size=64, shuffle=False)
````

## Ячейка 5: markdown

# Knowledge Distillation

## Ячейка 6: markdown

## Teacher Model

## Ячейка 7: code

````text
class TeacherNet(nn.Module):
    def __init__(self):
        super(TeacherNet, self).__init__()
        self.conv1 = nn.Conv2d(1, 32, 5)
        self.pool = nn.MaxPool2d(5, 5)
        self.fc1 = nn.Linear(32 * 4 * 4, 128)
        self.fc2 = nn.Linear(128, 10)

    def forward(self, x):
        x = F.relu(self.conv1(x))
        x = self.pool(x)
        x = x.view(x.size(0), -1)
        x = F.relu(self.fc1(x))
        x = self.fc2(x)
        return x        
````

## Ячейка 8: markdown

## Evaluation function

## Ячейка 9: code

````text
def evaluate(model):
    model.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for data in testloader:
            inputs, labels = data
            outputs = model(inputs)
            _, predicted = torch.max(outputs.data, 1)
            total += labels.size(0)
            correct += (predicted == labels).sum().item()
    return correct / total
````

## Ячейка 10: markdown

## Initialize and train the teacher model

## Ячейка 11: code

````text
teacher_model = TeacherNet()
teacher_optimizer = optim.Adam(teacher_model.parameters(), lr=0.001)
teacher_criterion = nn.CrossEntropyLoss()
````

## Ячейка 12: code

````text
for epoch in range(5):
    teacher_model.train()
    running_loss = 0.0
    
    for data in trainloader:
        inputs, labels = data
        teacher_optimizer.zero_grad()
        outputs = teacher_model(inputs)
        loss = teacher_criterion(outputs, labels)
        loss.backward()
        teacher_optimizer.step()
        
        running_loss += loss.item()
        
    teacher_accuracy = evaluate(teacher_model)
        
    print(f"Epoch {epoch + 1}, Loss: {running_loss / len(trainloader)}, Accuracy: {teacher_accuracy * 100:.2f}%")
````

## Ячейка 13: markdown

## Student Model

## Ячейка 14: code

````text
class StudentNet(nn.Module):
    def __init__(self):
        super(StudentNet, self).__init__()
        self.fc1 = nn.Linear(28 * 28, 128)
        self.fc2 = nn.Linear(128, 10)

    def forward(self, x):
        x = x.view(x.size(0), -1)
        x = F.relu(self.fc1(x))
        x = self.fc2(x)
        return x
````

## Ячейка 15: markdown

## Initialize and train the teacher model

## Ячейка 16: code

````text
student_model = StudentNet()
student_optimizer = optim.Adam(student_model.parameters(), lr=0.001)
````

## Ячейка 17: markdown

## Loss function (KL Divergence)

## Ячейка 18: code

````text
def knowledge_distillation_loss(student_logits, teacher_logits):
    p_teacher = F.softmax(teacher_logits , dim=1)
    p_student = F.log_softmax(student_logits, dim=1)
    loss = F.kl_div(p_student, p_teacher, reduction='batchmean')
    return loss
````

## Ячейка 19: code

````text
# Train the student model with knowledge distillation
for epoch in range(5):  # You can adjust the number of epochs
    student_model.train()
    running_loss = 0.0
    
    for data in trainloader:
        inputs, labels = data
        student_optimizer.zero_grad()
        student_logits = student_model(inputs)
        teacher_logits = teacher_model(inputs).detach()  # Detach the teacher's output to avoid backpropagation
        loss = knowledge_distillation_loss(student_logits, teacher_logits)
        loss.backward()
        student_optimizer.step()
        
        running_loss += loss.item()
    
    student_accuracy = evaluate(student_model)
        
    print(f"Epoch {epoch + 1}, Loss: {running_loss / len(testloader)}, Accuracy: {student_accuracy * 100:.2f}%")

````

## Ячейка 20: code

````text
%timeit evaluate(teacher_model)
````

## Ячейка 21: code

````text
%timeit evaluate(student_model) # student model runs faster
````

## Ячейка 22: markdown

Read about 5 more techniques for model compression here: [Machine Learning Model Compression: A Critical Step Towards Efficient Deep Learning](https://www.dailydoseofds.com/model-compression-a-critical-step-towards-efficient-machine-learning)