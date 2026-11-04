FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ENABLE_EXPERIMENTAL_BERT=false
RUN pip install --no-cache-dir fastapi uvicorn 'scipy>=1.13,<2' 'statsmodels>=0.14,<0.15'
COPY . ./
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
