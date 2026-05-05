package action.surefire.report.gradle;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PassingTest {

    @Test
    void keepsTheGreenPathGreen() {
        assertEquals("report", "report");
    }

    @Test
    void supportsMultiplePassingCases() {
        assertTrue(2 > 1);
    }
}
