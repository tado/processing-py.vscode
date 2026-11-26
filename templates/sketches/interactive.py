from processing_py import *

hue_shift = 0

def setup():
    size(600, 400)
    window_title("{{PROJECT_NAME}}")

def draw():
    background(20)
    no_stroke()
    fill(80 + hue_shift, 160, 255 - hue_shift)
    d = 120 if mouse_is_pressed else 60
    circle(mouse_x, mouse_y, d)

    fill(255)
    text_size(16)
    text("click: change color   s: save frame", 16, 28)

def mouse_pressed():
    global hue_shift
    hue_shift = (hue_shift + 40) % 160

def key_pressed():
    if key == "s":
        save_frame()

run()
