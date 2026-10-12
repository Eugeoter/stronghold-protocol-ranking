FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000
WORKDIR /app
COPY requirements.txt requirements-prod.txt ./
RUN pip install --no-cache-dir -r requirements-prod.txt
COPY app.py gunicorn.conf.py ./
COPY templates ./templates
COPY static ./static
COPY data/catalog.json ./data/catalog.json
EXPOSE 10000
CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:app"]
