package action.surefire.report.gradle;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class FailingTest {

    @Test
    void reportsReadableFailures() {
        assertEquals("expected", "actual");
    }
}
