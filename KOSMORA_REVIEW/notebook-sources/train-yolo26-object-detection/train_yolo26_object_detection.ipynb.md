# Исходные ячейки: train-yolo26-object-detection/train_yolo26_object_detection.ipynb

Извлечение без запуска. Выходы и изображения не включены; оригинал сохранён в upstream.

## Ячейка 0: markdown

# Train YOLO26 Object Detection Model on a Custom Dataset

<a target="_blank" href="https://github.com/ultralytics/ultralytics">
  <img src="https://img.shields.io/badge/Ultralytics-YOLO26-blue" alt="Ultralytics">
</a>

YOLO26 features a unified architecture that supports detection, segmentation, and pose tasks within a single model family. In this notebook, we fine-tune a YOLO26m checkpoint on a custom boxing-punch detection dataset from [Roboflow Universe](https://universe.roboflow.com/) and evaluate the results.

| Tool | Purpose |
|---|---|
| [Ultralytics](https://docs.ultralytics.com/) | YOLO26 training, validation, and inference |
| [Roboflow](https://roboflow.com/) | Dataset hosting and download |
| [Comet ML](https://www.comet.com/) | Experiment tracking and logging |
| [Supervision](https://supervision.roboflow.com/) | Detection visualization |

---

## Outline

1. **Setup** --- Environment and API keys (Roboflow, Comet), working directory
2. **Inference with pre-trained model** --- Run YOLO26m on a sample image; inspect detections and visualize with Supervision
3. **Fine-tune on custom dataset** --- Download a Roboflow dataset in YOLO26 format
4. **Model training** --- Train with Ultralytics, log to Comet; inspect training outputs (confusion matrix, curves, sample predictions)
5. **Validate fine-tuned model** --- Run validation on the best checkpoint
6. **Inference with fine-tuned model** --- Predict on test images; visualize a grid of annotated samples

## Ячейка 1: markdown

## Setup

Install dependencies, configure API keys, and set the working directory used for datasets and model outputs.

## Ячейка 2: markdown

### Configure API keys

To fine-tune YOLO26, you need to provide your Roboflow API key. Follow these steps:

- Store Roboflow API Key under the name `ROBOFLOW_API_KEY` in `.env` file.
- Store Comet API Key under the name `api_key` in `.comet.config` file.

## Ячейка 3: markdown

### Working directory

To simplify the management of datasets, images, and models, create a constant `HOME` pointing to the current working directory.

## Ячейка 4: code

````text
import os

# Root directory for datasets, runs, and sample images
HOME = os.getcwd()
print(HOME)
````

## Ячейка 5: code

````text
import ultralytics

# Verify Ultralytics install and environment (CUDA, dependencies)
ultralytics.checks()
````

## Ячейка 6: markdown

## Inference with pre-trained model

Run detection using the pre-trained YOLO26m checkpoint on a sample image. We also inspect detection outputs and visualize them with Supervision.

## Ячейка 7: markdown

Perform the same detection programmatically using the Ultralytics Python API. This gives direct access to bounding boxes, confidence scores, and class IDs.

## Ячейка 8: code

````text
from ultralytics import YOLO
from PIL import Image

# Load the pre-trained model
model = YOLO('yolo26m.pt')
image = Image.open(f'{HOME}/boxing.png')

# Perform inference
result = model.predict(image, verbose=False)[0]
````

## Ячейка 9: markdown

The obtained `result` object contains information about the location, classes, and confidence levels of the detected objects.

## Ячейка 10: code

````text
# Bounding box coordinates in (x_min, y_min, x_max, y_max) format
result.boxes.xyxy
````

## Ячейка 11: code

````text
# Confidence score for each detection
result.boxes.conf
````

## Ячейка 12: code

````text
# Class ID for each detection (maps to COCO category indices)
result.boxes.cls
````

## Ячейка 13: markdown

### Visualize detections

Convert the Ultralytics result to a Supervision `Detections` object, then draw bounding boxes and labels on the image using a helper function.

## Ячейка 14: code

````text
import supervision as sv

# Convert Ultralytics result to Supervision Detections
detections = sv.Detections.from_ultralytics(result)
````

## Ячейка 15: code

````text
import supervision as sv
from PIL import Image

def annotate(image: Image.Image, detections: sv.Detections) -> Image.Image:
    """Annotate an image with detections."""
    text_scale = sv.calculate_optimal_text_scale(resolution_wh=image.size)

    # Create annotators
    box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator(
        text_color=sv.Color.BLACK,
        text_scale=text_scale,
        smart_position=True
    )

    # Annotate and return
    out = image.copy()
    out = box_annotator.annotate(out, detections)
    out = label_annotator.annotate(out, detections)
    out.thumbnail((1000, 1000))
    return out
````

## Ячейка 16: code

````text
# Draw boxes and labels on the sample image
annotated_image = annotate(image, detections)
annotated_image
````

## Ячейка 17: markdown

## Fine-tune YOLO26 on custom dataset

Download a labeled dataset from Roboflow Universe in YOLO26-compatible format. We will use one of the [datasets](https://universe.roboflow.com/markmcquade/boxpunch-detector) available on [Roboflow Universe](https://universe.roboflow.com/). When downloading, make sure to select the `yolo26` export format.

## Ячейка 18: code

````text
# Create a directory to store the downloaded dataset
!mkdir {HOME}/datasets
%cd {HOME}/datasets

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from roboflow import Roboflow

# Authenticate with Roboflow and download the dataset in YOLO26 format
ROBOFLOW_API_KEY = os.environ.get('ROBOFLOW_API_KEY')
rf = Roboflow(api_key=ROBOFLOW_API_KEY)

project = rf.workspace("markmcquade").project("boxpunch-detector")
version = project.version(19)
dataset = version.download("yolo26")
````

## Ячейка 19: markdown

## Model Training

Launch YOLO26m fine-tuning. Training metrics are automatically logged to [Comet ML](https://www.comet.com/) for experiment tracking. Key parameters:

| Arguments | Value | Description |
|---|---|---|
| `model` | `yolo26m.pt` | Pre-trained checkpoint to start from |
| `epochs` | `20` | Number of training epochs |
| `imgsz` | `640` | Input image resolution |
| `plots` | `True` | Save training plots (confusion matrix, curves) |

## Ячейка 20: code

````text
import comet_ml

# Authenticate with Comet for experiment tracking
comet_ml.login(project_name="yolo26-object-detection")
````

## Ячейка 21: code

````text
%cd {HOME}

from ultralytics import YOLO

# Load the pre-trained model
model = YOLO('yolo26m.pt')

# Fine-tune YOLO26m on the downloaded dataset for 20 epochs
model.train(
    data=f'{dataset.location}/data.yaml',
    project='yolo26-object-detection',
    epochs=20,
    imgsz=640,
    plots=True
)
````

## Ячейка 22: markdown

### Inspect training artifacts

The training run saves results to `{HOME}/runs/detect/yolo26-object-detection/train/`. Let's inspect the confusion matrix, training curves, and sample validation predictions.

## Ячейка 23: code

````text
# List all saved training artifacts
!ls {HOME}/runs/detect/yolo26-object-detection/train/
````

## Ячейка 24: code

````text
# Confusion matrix: shows per-class prediction accuracy
from IPython.display import Image as IPyImage

IPyImage(filename=f'{HOME}/runs/detect/yolo26-object-detection/train/confusion_matrix.png', width=600)
````

## Ячейка 25: code

````text
# Training curves: loss and metrics over epochs
from IPython.display import Image as IPyImage

IPyImage(filename=f'{HOME}/runs/detect/yolo26-object-detection/train/results.png', width=600)
````

## Ячейка 26: code

````text
# Sample validation predictions from the final epoch
from IPython.display import Image as IPyImage

IPyImage(filename=f'{HOME}/runs/detect/yolo26-object-detection/train/val_batch0_pred.jpg', width=600)
````

## Ячейка 27: markdown

## Validate fine-tuned model

Run the Ultralytics validation mode on the best checkpoint to compute per-class precision, recall, mAP@50, and mAP@50-95 on the validation split.

## Ячейка 28: code

````text
from ultralytics import YOLO

# Load the fine-tuned model
model = YOLO(f'{HOME}/runs/detect/yolo26-object-detection/train/weights/best.pt')

# Evaluate the best checkpoint on the validation set
model.val(
    data=f'{dataset.location}/data.yaml',
    project='yolo26-object-detection'
)
````

## Ячейка 29: markdown

## Inference with fine-tuned model

Run the fine-tuned model on the held-out test set. Then visualize a random grid of annotated predictions.

## Ячейка 30: markdown

Load the fine-tuned model, run inference on test images, and visualize a 3x3 grid of annotated predictions using Supervision and Matplotlib.

## Ячейка 31: code

````text
from ultralytics import YOLO

# Load the fine-tuned model
model = YOLO(f'{HOME}/runs/detect/yolo26-object-detection/train/weights/best.pt')
````

## Ячейка 32: code

````text
import supervision as sv

# Load the test split as a Supervision DetectionDataset for easy iteration
ds_test = sv.DetectionDataset.from_yolo(
    images_directory_path=f"{dataset.location}/test/images",
    annotations_directory_path=f"{dataset.location}/test/labels",
    data_yaml_path=f"{dataset.location}/data.yaml"
)
````

## Ячейка 33: code

````text
import supervision as sv
from PIL import Image

def annotate(image: Image.Image, detections: sv.Detections) -> Image.Image:
    """Annotate an image with detections."""
    color = sv.ColorPalette.from_hex([
        "#9999ff", "#3399ff", "#66ffff", "#33ff99", "#66ff66", "#99ff00",
        "#ffff00", "#ff9b00", "#ff8080", "#ff66b2", "#ff66ff", "#b266ff",
    ])

    text_scale = sv.calculate_optimal_text_scale(resolution_wh=image.size)

    # Create annotators
    box_annotator = sv.BoxAnnotator(color=color)
    label_annotator = sv.LabelAnnotator(
        color=color,
        text_color=sv.Color.BLACK,
        text_scale=text_scale,
        smart_position=True
    )

    # Annotate and return
    out = image.copy()
    out = box_annotator.annotate(out, detections)
    out = label_annotator.annotate(out, detections)
    out.thumbnail((1000, 1000))
    return out
````

## Ячейка 34: code

````text
%matplotlib inline
import random
import matplotlib.pyplot as plt

N = 9
L = len(ds_test)

# Run inference on N randomly sampled test images and collect annotated results
annotated_images = []

for i in random.sample(range(L), N):
    path, _, annotations = ds_test[i]
    image = Image.open(path)
    result = model.predict(image, verbose=False)[0]
    detections = sv.Detections.from_ultralytics(result)
    annotated_image = annotate(image, detections)
    annotated_images.append(annotated_image)

# Display annotated images in a 3x3 grid
fig, axes = plt.subplots(3, 3, figsize=(12, 12))

for ax, img in zip(axes.flat, annotated_images):
    ax.imshow(img)
    ax.axis("off")

plt.subplots_adjust(wspace=0.02, hspace=0.02, left=0.01, right=0.99, top=0.99, bottom=0.01)

fig
````

## Ячейка 35: code

````text
# Close-up view of a single annotated prediction
annotated_images[0]
````

## Ячейка 36: markdown

## Key Features

- **Experiment tracking with Comet ML** --- Training metrics, hyperparameters, and artifacts are logged automatically for reproducibility and comparison across runs.
- **End-to-end workflow** --- The notebook covers the full cycle: pre-trained inference, dataset download, fine-tuning, validation, and test-set evaluation in a single, reproducible pipeline.

## Ячейка 37: markdown

## Conclusion

In this notebook we demonstrated how to fine-tune YOLO26m on a custom boxing-punch detection dataset. Starting from a COCO-pretrained checkpoint, the model was trained for 20 epochs on a Roboflow-hosted dataset and evaluated on a held-out validation split. The fine-tuned model successfully learned to localize punches in unseen test images, as shown in the annotated prediction grid.

To extend this workflow you can:

- **Try other model sizes** --- YOLO26 is available in nano, small, medium, large, and extra-large variants (`yolo26n`, `yolo26s`, `yolo26m`, `yolo26l`, `yolo26x`) to trade off speed and accuracy.
- **Deploy the model** --- Export the best checkpoint to ONNX, TensorRT, or CoreML for production inference using `model.export()`.