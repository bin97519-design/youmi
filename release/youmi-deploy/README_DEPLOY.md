# Youmi Deploy Package

## Frontend

Deploy `frontend/dist` as the static site.

## Backend

Requires Java 17.

```bash
cd /opt/youmi/backend
chmod +x start-backend.sh
./start-backend.sh
```

The backend startup script reads `backend/.env` if it exists, enables the `dev` profile by default, and loads config files from the backend directory.

Backend jar:

```text
backend/youmi-api-0.1.0.jar
```
