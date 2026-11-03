package cart;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

// A second class, so the runner writes a second JUnit XML file.
class PriceTest {
    @Test
    void addsTax() {
        assertEquals(120, 100 * 120 / 100);
    }
}
