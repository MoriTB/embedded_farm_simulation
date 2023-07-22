# embedded_farm_simulation
This is a centralized embedded and real time system where the main goal is to distribute food between animal feed containers. This process can be extensive and tiring on a large scale. Therefore, the use of real time and embedded processes in different parts of this large project can greatly help the farm conditions and provide fresh and healthy food for the animals, which ultimately has a huge impact on the final quality of farm products. For example, the taste of animals' meat as they have been fed under the best possible conditions.

In this embedded system, the main goal is that different tasks are defined to serve multiple purposes and be executed in an integrated and coordinated manner as different pieces of a puzzle. For example, the feed container is filled before the fresh food ends and the remaining food is reduced at the required time.

This system is also real time and can be considered soft real-time in the sense that if tasks like adding food are missed, nothing special happens, but animals may have to wait several times longer for the container to fill again and the next task of filling actually executes.

There are 6 tasks in this system that are all linked together to form this animal farm.

Task 1: Read information from load cell and add/update to resource in memory. In this task, reading information from the load cell pin and adding it to the main weight which is the resource. A semaphore is used to handle changes to the weight resource.

Task 2: Servo motor rotation (can be interpreted as opening or closing the feed container/animal entrance and exit). This task takes into account the time to change the capacity of the feed container that will open and close at specific times and tries to prioritize based on the process.

Task 3: Buzzer (to attract animals toward the feed). This task tries to make noise periodically when the feed container is available with a specified computation time and continue this task periodically.

Task 4: Blinking light (to show the start of the farm day). In this task, it also tries to produce light periodically when the feed container is available with a specified computation time, although an offset has been added here to have a more complicated implementation and avoid exact synchronization.

Task 5: Adding weight (automatically) In this task, it tries to add a specified weight (150 grams) based on access to the global weight (shared resource) when the weight is less than 1000 grams. A semaphore is also implemented here to avoid processing problems.

Task 6: Reducing weight (automatically) In this task, it tries to reduce a specified weight (100 grams) based on access to the global weight (shared resource) when the weight is more than 90 grams. A semaphore is also implemented here to avoid processing problems. (In fact, animals feed on food in a periodic process and it is also tried to be implemented as a task here).

In this system, it has been tried to be implemented based on RM and is shaped based on the periodic algorithm scheduling and even to the possibility that if a task is added or for reasons uryodhad or even two tasks with the same period, or even aperiodic tasks and their implementation with the rest of the tasks has been prioritized.
