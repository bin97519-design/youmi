package com.youmi.api.ai;

import java.util.List;

public record VisionElement(String objectName, List<Double> box2d) {}
