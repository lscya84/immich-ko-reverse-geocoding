import time
import psycopg2  # PostgreSQL 연결 라이브러리

def connect_to_db():
    retries = 5  # 최대 재시도 횟수
    wait_time = 10  # 재시도 간격 (초)
    
    for attempt in range(1, retries + 1):
        try:
            # PostgreSQL 연결 시도 (데이터는 적절히 수정)
            conn = psycopg2.connect(
                dbname="your_database_name",
                user="your_db_user",
                password="your_db_password",
                host="immich_postgres",
                port=5432
            )
            print("✅ Database connection established!")
            return conn
        except psycopg2.OperationalError as e:
            print(f"DB 연결 실패 (시도 {attempt}/{retries}): {e}")
            if attempt == retries:
                raise Exception("❌ Database connection failed after maximum retries.")
            print(f"{wait_time}초 후 재시도합니다...")
            time.sleep(wait_time)

def main():
    # DB 연결
    db_connection = connect_to_db()
    
    # 워커의 주요 로직 실행
    print("🚀 워커 시작...")
    # your_worker_logic()

if __name__ == "__main__":
    main()