FROM node:18-alpine
RUN apk add --no-cache python3 make g++ bash
RUN npm install -g Haraka mongodb
WORKDIR /haraka
RUN haraka -i /haraka
COPY config/ /haraka/config/
COPY plugins/ /haraka/plugins/
EXPOSE 25
CMD ["haraka", "-c", "/haraka"]
