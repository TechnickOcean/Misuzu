from ipaddress import ip_address
from flask import Flask, request, render_template, redirect, url_for, session, flash
import subprocess
import platform

app = Flask(__name__)
app.secret_key = 'secret_key_changed_in_container'

@app.route('/')
def index():
    current_user = session.get('user')
    return render_template('index.html', current_user=current_user)

@app.route('/ping', methods=['POST'])
def ping():
    target = request.form.get('target', '')
    current_user = session.get('user')
    if current_user and current_user.upper() != 'ADMIN':
        return render_template(
            'index.html', 
            ping_result="只有管理员可以使用此工具。", 
            current_user=current_user
        )
    if not current_user:
         return render_template(
            'index.html', 
            ping_result="只有管理员可以使用此工具。", 
            current_user=None
        )
    
    if not target:
        return render_template('index.html', ping_result="请输入目标地址", current_user=current_user)
    try:
        target = ip_address(target).compressed
    except Exception:
        return render_template('index.html', ping_result="ip地址非法", current_user=current_user)

    param = '-n' if platform.system().lower() == 'windows' else '-c'
    
    try:
        command = f'ping {param} 4 {target}'
        result = subprocess.run(
            command, 
            shell=True,
            capture_output=True, 
            text=True, 
            timeout=10
        )
        output = result.stdout if result.returncode == 0 else result.stderr
        if not output:
             output = "Ping 失败或无法解析主机。"

    except subprocess.TimeoutExpired:
        output = "请求超时。"
    except Exception as e:
        output = f"执行错误: {str(e)}"

    return render_template('index.html', ping_result=output, current_user=current_user)

@app.route('/set_user_session', methods=['POST'])
def set_user_session():
    username = request.form.get('username', '').strip()

    if username.lower() == 'admin':
        flash("禁止操作：不允许设置 'admin' 用户名！")
        return redirect(url_for('index'))

    session['user'] = username
    flash(f"用户名已更新为: {username}")
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    session.pop('user', None)
    flash("已退出登录。")
    return redirect(url_for('index'))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)