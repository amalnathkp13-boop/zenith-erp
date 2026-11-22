import org.moqui.entity.EntityCondition

def factory = ec.entity.conditionFactory
def selected = factory.makeCondition('currencyUomId', EntityCondition.EQUALS, currency)
return includeUnspecified ? factory.makeCondition(selected, EntityCondition.OR,
        factory.makeCondition('currencyUomId', EntityCondition.EQUALS, null)) : selected
