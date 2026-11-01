FROM alpine:3.22
RUN apk add --no-cache ffmpeg python3 fontconfig ttf-dejavu
COPY server.py /server.py
EXPOSE 8080
CMD ["python3", "-u", "/server.py"]
