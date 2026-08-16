from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).parent
CELL_WIDTH = 250
IMAGE_HEIGHT = 542
LABEL_HEIGHT = 34
COLUMNS = 3
MARGIN = 18
TITLE_HEIGHT = 56

GROUPS = [
    (
        "01-core-navigation-map",
        "Core navigation and map",
        [
            "01-map-main.png",
            "02-feed-main.png",
            "03-map-3d.png",
            "04-map-globe-zoomed-out.png",
            "05-map-search.png",
            "29-map-show-me.png",
            "56b-map-controls-aligned-active.png",
            "57-map-sun-moon.png",
            "25-feed-hold-menu.png",
            "26-map-hold-menu.png",
            "27-camera-hold-menu.png",
            "28-profile-hold-menu.png",
        ],
    ),
    (
        "02-upload-posting",
        "Capture, upload, edit, and post",
        [
            "06-camera-main.png",
            "07-camera-roll-permission.png",
            "08-camera-roll.png",
            "09-upload-edit.png",
            "10-upload-video-editor.png",
            "11-upload-original-or-ai.png",
            "12-upload-ai.png",
            "13-upload-channel-and-location.png",
            "14-upload-pick-map-spot-ready.png",
            "15-map-post-composer.png",
            "16-map-post-result.png",
        ],
    ),
    (
        "03-profile-messages-stats",
        "Profile, messages, and stats",
        [
            "17-profile-media.png",
            "18-profile-notifications.png",
            "19-profile-messages-tab.png",
            "20-profile-liked-tab.png",
            "21-profile-expanded-post.png",
            "22-profile-photo-camera.png",
            "23-profile-photo-viewfinder.png",
            "61-profile-mail.png",
            "62-profile-mail-thread.png",
            "63-profile-mail-sent.png",
            "74-profile-stats.png",
            "75-profile-stats-detail.png",
        ],
    ),
    (
        "04-media-social-ai",
        "Radio, news, TV, social actions, and AI",
        [
            "30-radio.png",
            "31-news.png",
            "32-tv-guide.png",
            "33-tv-guide-tuned-feed.png",
            "34-feed-share.png",
            "35-feed-comment-composer.png",
            "36-feed-poster-profile.png",
            "55-ai-chat-empty.png",
            "58-ai-chat-settings.png",
            "59-ai-chat-response.png",
            "60-ai-attachment-handoff.png",
        ],
    ),
    (
        "05-games",
        "Games walkthrough",
        [
            "37-games-library.png",
            "38-games-boot.png",
            "39-poplurgatchi-menu.png",
            "40-poplurgatchi-idle.png",
            "41-fps-title.png",
            "42-fps-boot.png",
            "43-fps-game.png",
            "44-fps-playing.png",
            "45-fps-paused.png",
        ],
    ),
    (
        "06-studio",
        "Studio walkthrough",
        [
            "46-studio-mic.png",
            "47-studio-recording.png",
            "48-studio-style.png",
            "49-studio-generating.png",
            "50-studio-arrangement.png",
            "51-studio-browser.png",
            "52-studio-tracks.png",
            "53-studio-mixer.png",
            "54-studio-export.png",
        ],
    ),
    (
        "07-store-phone",
        "Store and Poplur phone",
        [
            "64-profile-store.png",
            "65-store-hardware.png",
            "66-store-cards.png",
            "67-store-radius.png",
            "68-store-product.png",
            "69-store-cart.png",
            "70-profile-phone-boot.png",
            "71-profile-phone-menu.png",
            "72-profile-phone-games.png",
            "73-profile-phone-snake.png",
        ],
    ),
    (
        "08-settings",
        "Categorized settings",
        [
            "76-profile-settings.png",
            "77-profile-settings-full.png",
            "78-settings-video-duration.png",
            "79-settings-translation.png",
            "80-settings-demo-data.png",
            "81-settings-demo-controls.png",
            "82-settings-maintenance.png",
            "83-settings-backup.png",
            "84-settings-about.png",
            "85-settings-terms.png",
            "86-settings-sign-out.png",
        ],
    ),
    (
        "09-map-camera-subscreens",
        "Map and camera subscreens",
        [
            "87-map-locate.png",
            "88-map-post.png",
            "89-map-tour.png",
            "90-map-search.png",
            "91-map-claims.png",
            "92-map-chat.png",
            "93-camera-capture-twin.png",
            "94-camera-roll-twin.png",
            "95-camera-create.png",
            "96-camera-preview.png",
            "97-camera-live.png",
        ],
    ),
    (
        "10-social-subscreens",
        "Social and profile subscreens",
        [
            "98-camera-chat.png",
            "99-camera-store.png",
            "100-feed-tv-twin.png",
            "101-feed-news-twin.png",
            "102-feed-music.png",
            "103-feed-games-twin.png",
            "104-feed-like.png",
            "105-feed-cc.png",
            "106-profile-alerts-twin.png",
            "107-profile-creator.png",
        ],
    ),
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


TITLE_FONT = load_font(25)
LABEL_FONT = load_font(12)


def make_sheet(slug: str, title: str, names: list[str]) -> None:
    rows = (len(names) + COLUMNS - 1) // COLUMNS
    width = MARGIN * 2 + CELL_WIDTH * COLUMNS
    height = TITLE_HEIGHT + MARGIN + rows * (IMAGE_HEIGHT + LABEL_HEIGHT)
    sheet = Image.new("RGB", (width, height), "#111016")
    draw = ImageDraw.Draw(sheet)
    draw.text((MARGIN, 14), title, fill="white", font=TITLE_FONT)

    for index, name in enumerate(names):
        source = ROOT / name
        if not source.exists():
            raise FileNotFoundError(source)

        image = Image.open(source).convert("RGB")
        image.thumbnail((CELL_WIDTH, IMAGE_HEIGHT), Image.Resampling.LANCZOS)
        column = index % COLUMNS
        row = index // COLUMNS
        x = MARGIN + column * CELL_WIDTH + (CELL_WIDTH - image.width) // 2
        y = TITLE_HEIGHT + row * (IMAGE_HEIGHT + LABEL_HEIGHT)
        sheet.paste(image, (x, y))

        label = Path(name).stem.replace("-", " ")
        label_box = draw.textbbox((0, 0), label, font=LABEL_FONT)
        label_width = label_box[2] - label_box[0]
        label_x = MARGIN + column * CELL_WIDTH + (CELL_WIDTH - label_width) // 2
        draw.text(
            (max(MARGIN + column * CELL_WIDTH + 4, label_x), y + IMAGE_HEIGHT + 8),
            label,
            fill="#f4d7e8",
            font=LABEL_FONT,
        )

    sheet.save(ROOT / f"contact-{slug}.jpg", quality=91, optimize=True)


for group in GROUPS:
    make_sheet(*group)
