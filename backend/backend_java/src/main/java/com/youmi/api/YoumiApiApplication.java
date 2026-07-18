package com.youmi.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class YoumiApiApplication {
  public static void main(String[] args) {
    SpringApplication.run(YoumiApiApplication.class, args);
  }
}
