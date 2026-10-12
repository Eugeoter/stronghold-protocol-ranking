"""Production server configuration for Render and container hosting."""
import os

bind = '0.0.0.0:' + os.environ.get('PORT', '10000')
workers = int(os.environ.get('WEB_CONCURRENCY', '1'))
worker_class = 'gthread'
threads = 4
timeout = 60
graceful_timeout = 30
keepalive = 5
accesslog = '-'
errorlog = '-'
capture_output = True
preload_app = True
