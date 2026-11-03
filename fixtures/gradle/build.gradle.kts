// Used by .github/workflows/smoke.yml: a real `gradle test` run whose allure-results folder (job gradle) and
// build/test-results/test folder (job gradle-junit) the action imports.
plugins {
    java
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.14.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    // allure-junit5 was renamed: from 2.35.1 it is only a relocation POM with no jar of its own.
    testImplementation("io.qameta.allure:allure-jupiter:2.35.5")
}

tasks.test {
    useJUnitPlatform()
    // Allure's default is ./allure-results; build/allure-results is the folder the workflow imports.
    systemProperty("allure.results.directory", layout.buildDirectory.dir("allure-results").get().asFile.path)
}
