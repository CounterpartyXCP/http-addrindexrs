FROM node:14-alpine

RUN apk add --update bash

RUN mkdir /http-addrindexrc/

COPY ./package.json /http-addrindexrc/package.json
WORKDIR /http-addrindexrc

RUN npm install
RUN npm install --global

COPY ./src ./src

CMD ["npm", "run", "main"]

