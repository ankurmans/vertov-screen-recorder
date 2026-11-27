FROM alpine:3.24
RUN apk add --no-cache ffmpeg python3 py3-pillow fontconfig ttf-dejavu
COPY *.py /
COPY fonts /fonts
COPY backgrounds /backgrounds
EXPOSE 8080
CMD ["python3", "-u", "/server.py"]
