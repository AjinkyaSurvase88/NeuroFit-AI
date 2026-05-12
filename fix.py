import os
import glob

files = glob.glob('**/*.py', recursive=True) + glob.glob('**/*.js', recursive=True) + glob.glob('**/*.html', recursive=True) + glob.glob('**/*.css', recursive=True)

for f in files:
    if f == 'fix.py' or 'venv' in f: continue
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Replace literal backslash followed by quote with just quote
    new_content = content.replace(r'\"', '\"')
    
    if new_content != content:
        with open(f, 'w', encoding='utf-8') as file:
            file.write(new_content)
        print(f'Fixed {f}')
