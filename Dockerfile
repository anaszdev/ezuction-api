# 1. مرحلة البناء والتهيئة (Build Stage)
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# نسخ ملفات الاعتماديات أولاً لتسريع الـ Caching في Docker
COPY package*.json ./
COPY prisma ./prisma/

# تثبيت جميع الاعتماديات (بما فيها الخاصة بالتطوير لعمل الـ Build)
RUN npm ci

# نسخ باقي ملفات المشروع
COPY . .

# بناء المشروع وتوليد ملفات Prisma Client
RUN npx prisma generate
RUN npm run build

# 2. مرحلة التشغيل الفعلية (Production Stage - خفيفة جداً ومؤمنة)
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

# تثبيت اعتماديات التشغيل فقط (Production dependencies) لتقليل حجم الحاوية
RUN npm ci --only=production

# نسخ الملفات المبنية من المرحلة السابقة
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /usr/src/app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /usr/src/app/prisma ./prisma

EXPOSE 3000

# تشغيل التطبيق
CMD ["node", "dist/main"]