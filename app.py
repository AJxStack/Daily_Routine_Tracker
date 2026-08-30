import mysql.connector
import bcrypt
import jwt
import datetime
from functools import wraps
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


# ── SERVE FRONTEND FILES ──
@app.route('/')
def home():
    return send_from_directory('.', 'index.html')


@app.route('/<path:filename>')
def serve_files(filename):
    return send_from_directory('.', filename)


SECRET_KEY = 'drt_secret_key_2024'

db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': 'D_R_T@123',
    'database': 'routine_tracker'
}


def get_db():
    return mysql.connector.connect(**db_config)


def create_token(user_id):
    payload = {
        'user_id': user_id,
        'exp': datetime.datetime.utcnow() + datetime.timedelta(days=7)
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm='HS256'
    )


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):

        token = request.headers.get(
            'Authorization',
            ''
        ).replace('Bearer ', '')

        if not token:
            return jsonify({
                'error': 'Token missing'
            }), 401

        try:
            data = jwt.decode(
                token,
                SECRET_KEY,
                algorithms=['HS256']
            )

            request.user_id = data['user_id']

        except jwt.ExpiredSignatureError:

            return jsonify({
                'error': 'Token expired'
            }), 401

        except jwt.InvalidTokenError:

            return jsonify({
                'error': 'Invalid token'
            }), 401

        return f(*args, **kwargs)

    return decorated


# ── SIGNUP ──
@app.route('/signup', methods=['POST'])
def signup():

    data = request.json

    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '').strip()

    if not name or not email or not password:
        return jsonify({
            'error': 'All fields are required'
        }), 400

    if len(password) < 6:
        return jsonify({
            'error': 'Password must be at least 6 characters'
        }), 400

    hashed = bcrypt.hashpw(
        password.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')

    try:

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO users
            (name, email, password)
            VALUES (%s, %s, %s)
            """,
            (
                name,
                email,
                hashed
            )
        )

        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({
            'message': 'Account created successfully!'
        }), 201

    except mysql.connector.IntegrityError:

        return jsonify({
            'error': 'Email already registered'
        }), 409

    except Exception as e:

        return jsonify({
            'error': str(e)
        }), 500


# ── LOGIN ──
@app.route('/login', methods=['POST'])
def login():

    data = request.json

    email = data.get('email', '').strip()
    password = data.get('password', '').strip()

    if not email or not password:
        return jsonify({
            'error': 'Email and password are required'
        }), 400

    try:

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute(
            "SELECT * FROM users WHERE email = %s",
            (email,)
        )

        user = cursor.fetchone()

        cursor.close()
        conn.close()

        if user and bcrypt.checkpw(
            password.encode('utf-8'),
            user['password'].encode('utf-8')
        ):

            token = create_token(user['id'])

            return jsonify({
                'message': 'Login successful',
                'token': token,
                'name': user['name'],
                'email': user['email']
            }), 200

        return jsonify({
            'error': 'Invalid email or password'
        }), 401

    except Exception as e:

        return jsonify({
            'error': str(e)
        }), 500


# ── GET TASKS ──
@app.route('/tasks', methods=['GET'])
@token_required
def get_tasks():

    try:

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        cursor.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = %s
            ORDER BY time_str
            """,
            (request.user_id,)
        )

        rows = cursor.fetchall()

        tasks = []

        for row in rows:

            cursor.execute(
                """
                SELECT completed_date
                FROM completions
                WHERE task_id = %s
                """,
                (row['id'],)
            )

            dates = [
                str(r['completed_date'])
                for r in cursor.fetchall()
            ]

            tasks.append({
                'id': row['id'],
                'title': row['title'],
                'cat': row['cat'],
                'time': row['time_str'],
                'completions': dates
            })

        cursor.close()
        conn.close()

        return jsonify(tasks)

    except Exception as e:

        return jsonify({
            'error': str(e)
        }), 500


# ── ADD TASK ──
@app.route('/tasks', methods=['POST'])
@token_required
def add_task():

    data = request.json

    title = data.get('title', '').strip()
    cat = data.get('cat', 'General')
    time_str = data.get('time', '')

    if not title:

        return jsonify({
            'error': 'Title is required'
        }), 400

    try:

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            """
            INSERT INTO tasks
            (user_id, title, cat, time_str)
            VALUES (%s, %s, %s, %s)
            """,
            (
                request.user_id,
                title,
                cat,
                time_str
            )
        )

        conn.commit()

        new_id = cursor.lastrowid

        cursor.close()
        conn.close()

        return jsonify({
            'id': new_id,
            'title': title,
            'cat': cat,
            'time': time_str,
            'completions': []
        }), 201

    except Exception as e:

        return jsonify({
            'error': str(e)
        }), 500


# ── TOGGLE TASK COMPLETION ──
@app.route('/tasks/toggle', methods=['POST'])
@token_required
def toggle_task():

    data = request.json

    task_id = data.get('taskId')
    date = data.get('date')
    is_done = data.get('isDone')

    try:

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        # Verify task belongs to this user
        cursor.execute(
            """
            SELECT id
            FROM tasks
            WHERE id = %s
            AND user_id = %s
            """,
            (
                task_id,
                request.user_id
            )
        )

        if not cursor.fetchone():

            cursor.close()
            conn.close()

            return jsonify({
                'error': 'Unauthorized'
            }), 403

        if is_done:

            cursor.execute(
                """
                INSERT IGNORE INTO completions
                (task_id, completed_date)
                VALUES (%s, %s)
                """,
                (
                    task_id,
                    date
                )
            )

        else:

            cursor.execute(
                """
                DELETE FROM completions
                WHERE task_id = %s
                AND completed_date = %s
                """,
                (
                    task_id,
                    date
                )
            )

        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({
            'status': 'success'
        })

    except Exception as e:

        return jsonify({
            'error': str(e)
        }), 500


# ── DELETE TASK ──
@app.route('/tasks/<int:id>', methods=['DELETE'])
@token_required
def delete_task(id):

    try:

        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            """
            DELETE FROM tasks
            WHERE id = %s
            AND user_id = %s
            """,
            (
                id,
                request.user_id
            )
        )

        conn.commit()

        cursor.close()
        conn.close()

        return jsonify({
            'status': 'deleted'
        })

    except Exception as e:

        return jsonify({
            'error': str(e)
        }), 500


# ── GET STATS ──
@app.route('/stats', methods=['GET'])
@token_required
def get_stats():

    try:

        conn = get_db()
        cursor = conn.cursor(dictionary=True)

        # Get all tasks for this user
        cursor.execute(
            """
            SELECT id
            FROM tasks
            WHERE user_id = %s
            """,
            (request.user_id,)
        )

        task_ids = [
            r['id']
            for r in cursor.fetchall()
        ]

        total_tasks = len(task_ids)

        # Get completions for last 30 days
        stats = []

        for i in range(29, -1, -1):

            d = (
                datetime.datetime.utcnow()
                - datetime.timedelta(days=i)
            ).strftime('%Y-%m-%d')

            if task_ids:

                format_strings = ','.join(
                    ['%s'] * len(task_ids)
                )

                cursor.execute(
                    f"""
                    SELECT COUNT(*) as cnt
                    FROM completions
                    WHERE task_id IN ({format_strings})
                    AND completed_date = %s
                    """,
                    (*task_ids, d)
                )

                done = cursor.fetchone()['cnt']

            else:

                done = 0

            stats.append({
                'date': d,
                'done': done,
                'total': total_tasks
            })

        cursor.close()
        conn.close()

        return jsonify(stats)

    except Exception as e:

        return jsonify({
            'error': str(e)
        }), 500


# ── RUN SERVER ──
if __name__ == '__main__':
    app.run(
        debug=True,
        port=5000
    )
