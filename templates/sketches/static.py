from processing_py import *

# Import standard-library modules AFTER the wildcard import:
# processing_py exports its own `math`, `round`, `pow`, `set` and `filter`.
import random

def setup():
    size(400, 400)
    background(30)
    no_stroke()
    for _ in range(200):
        fill(random.randint(100, 255), random.randint(50, 200), 220, 180)
        d = random.uniform(5, 40)
        circle(random.uniform(0, width), random.uniform(0, height), d)
    no_loop()

def draw():
    pass

run()
