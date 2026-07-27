from pathlib import Path

import torch
from PIL import Image
from transformers import CLIPProcessor, CLIPModel


# Load CLIP
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

# Folder containing your images
IMAGE_FOLDER = Path("./images")

# What we're looking for
TEXT = "a photo of a dog"

# Find images
image_paths = [
    p for p in IMAGE_FOLDER.iterdir()
    if p.suffix.lower() in [".jpg", ".jpeg", ".png", ".webp"]
]

# Load images
images = [Image.open(path).convert("RGB") for path in image_paths]

# Run CLIP
inputs = processor(
    text=[TEXT],
    images=images,
    return_tensors="pt",
    padding=True,
)

with torch.no_grad():
    outputs = model(**inputs)

# Similarity between the text and each image
scores = outputs.logits_per_text[0]

# Sort from most similar to least similar
results = sorted(
    zip(image_paths, scores),
    key=lambda x: x[1],
    reverse=True,
)

# Print results
for path, score in results:
    print(f"{score.item():.3f}  {path}")