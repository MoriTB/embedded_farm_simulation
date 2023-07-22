#include <Arduino.h>
#include <HX711.h>
#include <Servo.h>
#include <Arduino_FreeRTOS.h>
#include <task.h>
#include <semphr.h>
const int LOADCELL_DOUT_PIN = 52;
const int LOADCELL_SCK_PIN = 53;
HX711 scale;
Servo myservo;
SemaphoreHandle_t weightSemaphore; 

int weight = 0; // shared reasource ( global variable for weight ) 

// Task periods (in milliseconds)
const int led1TaskPeriod = 1000;
const int ServoTaskPeriod = 2500;

// Task deadlines (in milliseconds)
const int led1TaskDeadline = 1050;
const int ServoTaskDeadline = 2500;



byte servo = 51;
byte Gledpin = 23;
byte buzzerpin = 22;
byte Rledpin = 24;
int Redpin = 9;
int prev_weight = -1;
long myTimer = 0;
long myTimeout = 3000;
// adding offset to a task.
int taskOffset = 300;
void TaskServo(void *pvParameters);
void TaskBuzzer(void *pvParameters);
void setup() {
  Serial.begin(9600);
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);
  Serial.println("Starting ...");
  myservo.attach(servo);
  pinMode(buzzerpin, OUTPUT);
  pinMode(Redpin, OUTPUT);
  scale.set_scale(30.23);
  scale.tare();  
  weightSemaphore =xSemaphoreCreateMutex();
  inittasks();
}

void loop() {
  // Nothing to do here, all work is done in tasks
}
void inittasks() {
  xTaskCreate(
    TaskLoadcellRead, 
    "Loadcell",
    128,  
    NULL,
    1,
    NULL  
  );
  xTaskCreate(
    TaskServo,
    "Servo",
    128,
    NULL, 
    2,
    NULL  
  );
  xTaskCreate(
  TaskBuzzer,
   "Buzzer",
  100,
  NULL,
  3,
  NULL
  );
  xTaskCreate(
  TaskLED,
   "LED",
  100,
  NULL,
  4,
  NULL
  );
  xTaskCreate(
  TaskAddWeight,
  "AddWeight",
  128,
  NULL,
  4,
  NULL
  );
  xTaskCreate(
  TaskRemoveWeight,
  "RemoveWeight",
  128,
  NULL,
  5,
  NULL
  );
}
void TaskLoadcellRead(void *pvParameters) {
  for (;;) {
    // Read changes from loadcell.
    readLoadcell();
    // Delay between reads
    vTaskDelay(3500 / portTICK_PERIOD_MS); 
  }
}int readLoadcell() {  
  int loadcellValue = scale.get_units(); 
  if (prev_weight != loadcellValue){
     xSemaphoreTake(weightSemaphore, portMAX_DELAY); 
     // we need to add to the weight we have right now.
     int weight_local = loadcellValue + weight;
     // it would help us to see if there is any change. 
     prev_weight =loadcellValue;  
     weight = weight_local;
     Serial.println("New manual weight");
     Serial.println(weight_local);
     xSemaphoreGive(weightSemaphore);   
    }   
}

void TaskServo(void *pvParameters){
  for(;;){
    myservo.write(180);   // Open servo 
    vTaskDelay(400 / portTICK_PERIOD_MS);
    myservo.write(0);    // Close servo
    vTaskDelay( 2500 / portTICK_PERIOD_MS );
  }
}
void TaskBuzzer(void *pvParameters) {
  for(;;){
  digitalWrite(buzzerpin, HIGH);
  vTaskDelay(1000 / portTICK_PERIOD_MS);
  digitalWrite(buzzerpin, LOW);
  vTaskDelay( 9000 / portTICK_PERIOD_MS );
  }
}
void TaskLED(void *pvParameters) {
  for(;;){
  digitalWrite(Redpin, HIGH);
  vTaskDelay(1000 / portTICK_PERIOD_MS);
  digitalWrite(Redpin, LOW);
  vTaskDelay( (1300 + taskOffset) / portTICK_PERIOD_MS );
  }
}
// it would add 100g to the the basket of food in a longer period.
void TaskAddWeight(void *pvParameters){
  for(;;){
    if( weight < 1000){  
      Serial.println("simple");
      xSemaphoreTake(weightSemaphore, portMAX_DELAY); 
      Serial.println("automatic weight has been added.");
      weight += 150;       
      xSemaphoreGive(weightSemaphore);      
      Serial.print("Weight: ");
      Serial.println(weight);
    }
    vTaskDelay(4333 / portTICK_PERIOD_MS);    
  }   
}
// its for when animals of this farm start to eat and based on the time they eat 100g in each period.
void TaskRemoveWeight(void *pvParameters){
  for(;;){  
    if (weight > 90){     
    xSemaphoreTake(weightSemaphore, portMAX_DELAY);
    Serial.println("automatic weight has been reduced.");
    weight -= 100; 
    xSemaphoreGive(weightSemaphore);     
    Serial.print("Weight: ");    
    Serial.println(weight);    
  }   
   vTaskDelay(800 / portTICK_PERIOD_MS);  
  }
}
