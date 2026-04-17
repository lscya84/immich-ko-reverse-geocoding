FROM node:18-alpine

WORKDIR /app

# 필요 패키지 설치
RUN npm init -y && npm install pg dotenv

# 스크립트 및 매핑 데이터 복사
COPY updater.js reverse_geocode.js mapping.json ./

# 실행
CMD ["node", "updater.js"]
