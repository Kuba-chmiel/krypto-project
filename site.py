import os
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

# --- НАСТРОЙКИ ---
# Укажите URL вашего сайта
BASE_URL = 'https://kryptobot.net'
# Название папки для сохранения сайта
OUTPUT_DIR = 'kryptobot_net_backup'
# -----------------

# Множество для хранения уже посещенных URL, чтобы избежать бесконечного цикла
processed_urls = set()

def download_asset(asset_url, output_folder):
    """Скачивает файл (CSS, JS, изображение и т.д.) по URL."""
    if not asset_url or not asset_url.startswith('http'):
        return None

    try:
        response = requests.get(asset_url, headers={'User-Agent': 'Mozilla/5.0'})
        response.raise_for_status()

        # Получаем путь для сохранения файла
        parsed_url = urlparse(asset_url)
        # Убираем начальный '/' из пути
        asset_path = parsed_url.path.lstrip('/')
        # Могут быть query параметры, создаем безопасное имя файла
        filename = os.path.join(output_folder, os.path.basename(asset_path))

        # Создаем поддиректории, если их нет
        os.makedirs(os.path.dirname(filename), exist_ok=True)

        with open(filename, 'wb') as f:
            f.write(response.content)
        print(f"✅ Скачан ассет: {asset_url}")
        return os.path.relpath(filename, start=output_folder) # Возвращаем относительный путь

    except requests.exceptions.RequestException as e:
        print(f"❌ Не удалось скачать ассет {asset_url}: {e}")
        return None
    except Exception as e:
        print(f"❌ Ошибка при сохранении ассета {asset_url}: {e}")
        return None


def scrape_page(page_url):
    """Рекурсивно сканирует и скачивает страницу и ее ресурсы."""
    if page_url in processed_urls:
        return
    processed_urls.add(page_url)

    print(f"\n Scraping: {page_url} ...")

    try:
        response = requests.get(page_url, headers={'User-Agent': 'Mozilla/5.0'})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # --- Скачиваем CSS ---
        css_folder = os.path.join(OUTPUT_DIR, 'css')
        for link in soup.find_all('link', rel='stylesheet'):
            href = link.get('href')
            if href:
                css_url = urljoin(BASE_URL, href)
                download_asset(css_url, css_folder)

        # --- Скачиваем JS ---
        js_folder = os.path.join(OUTPUT_DIR, 'js')
        for script in soup.find_all('script', src=True):
            src = script.get('src')
            if src:
                js_url = urljoin(BASE_URL, src)
                download_asset(js_url, js_folder)

        # --- Сохраняем HTML файл ---
        parsed_url = urlparse(page_url)
        path = parsed_url.path
        if path == '/' or not path:
            filename = os.path.join(OUTPUT_DIR, 'index.html')
        else:
            # Преобразуем путь в имя файла
            filename = os.path.join(OUTPUT_DIR, path.lstrip('/'))
            if not filename.endswith('.html'):
                 filename = os.path.join(filename, 'index.html')

        os.makedirs(os.path.dirname(filename), exist_ok=True)
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(soup.prettify())
        print(f"✅ Сохранена страница: {filename}")


        # --- Ищем другие страницы сайта для сканирования ---
        for a_tag in soup.find_all('a', href=True):
            link = a_tag.get('href')
            next_url = urljoin(BASE_URL, link)

            # Проверяем, что ссылка ведет на тот же домен и еще не обработана
            if urlparse(next_url).netloc == urlparse(BASE_URL).netloc:
                scrape_page(next_url)

    except requests.exceptions.RequestException as e:
        print(f"❌ Не удалось обработать страницу {page_url}: {e}")


if __name__ == '__main__':
    # Создаем основную директорию
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # Начинаем сканирование с главной страницы
    scrape_page(BASE_URL)
    print("\n🎉 Готово! Сайт был скопирован в папку:", OUTPUT_DIR)