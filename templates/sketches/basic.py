from processing_py import *

def setup():
    size(400, 400)
    background(255)

def draw():
    push_matrix()
    translate(mouse_x, mouse_y)
    fill(255, 100, 200)
    circle(0, 0, 50)
    pop_matrix()

run()
